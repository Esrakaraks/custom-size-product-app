import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { logEvent, checkErrorAlarm } from "../utils/logger.server.js";

const GET_TEMP_VARIANTS = `#graphql
  query GetTempVariants {
    productVariants(
      first: 250
      query: "metafield.custom.temporary:true"
    ) {
      edges {
        node {
          id
          displayName
          product { id }
          metafields(first: 20, namespace: "custom") {
            edges {
              node {
                key
                value
              }
            }
          }
        }
      }
    }
  }
`;

const PRODUCT_VARIANTS_BULK_DELETE = `#graphql
  mutation ProductVariantsBulkDelete(
    $productId: ID!
    $variantsIds: [ID!]!
  ) {
    productVariantsBulkDelete(
      productId: $productId
      variantsIds: $variantsIds
    ) {
      product { id }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function loader({ request }) {
  let cors = (res) => res;

  try {
    const auth = await authenticate.public.appProxy(request);
    const { admin } = auth;
    if (auth && typeof auth.cors === "function") {
      cors = auth.cors;
    }

    const nowIso = new Date().toISOString();

    logEvent({
      level: "info",
      action: "daily_cleanup_started",
      timestamp: nowIso,
    });

    const variantsResponse = await admin.graphql(GET_TEMP_VARIANTS);
    const variantsData = await variantsResponse.json();

    const edges = variantsData.data?.productVariants?.edges ?? [];

    logEvent({
      level: "info",
      action: "daily_cleanup_scan_result",
      found: edges.length,
    });

    let deletedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const { node } of edges) {
      const metafields = node.metafields?.edges ?? [];
      const deleteAtField = metafields.find(
        (m) => m.node.key === "delete_at"
      );

      if (!deleteAtField) {
        skippedCount++;

        logEvent({
          level: "info",
          action: "cleanup_variant_skipped",
          reason: "no_delete_at",
          variant: node.displayName,
        });

        continue;
      }

      const deleteAt = deleteAtField.node.value;

      if (deleteAt >= nowIso) {
        skippedCount++;

        logEvent({
          level: "info",
          action: "cleanup_variant_not_expired",
          variant: node.displayName,
          deleteAt,
        });

        continue;
      }

      const deleteResponse = await admin.graphql(
        PRODUCT_VARIANTS_BULK_DELETE,
        {
          variables: {
            productId: node.product.id,
            variantsIds: [node.id],
          },
        }
      );

      const deleteJson = await deleteResponse.json();
      const result = deleteJson.data?.productVariantsBulkDelete;

      if (!result || (result.userErrors && result.userErrors.length > 0)) {
        const err = result?.userErrors || deleteJson.errors || [];

        errors.push({ variant: node.displayName, err });

        logEvent({
          level: "error",
          action: "cleanup_delete_failed",
          variant: node.displayName,
          errors: err,
        });

        checkErrorAlarm();
      } else {
        deletedCount++;

        logEvent({
          level: "info",
          action: "cleanup_variant_deleted",
          variant: node.displayName,
        });
      }
    }

    logEvent({
      level: "info",
      action: "daily_cleanup_finished",
      deletedCount,
      skippedCount,
      totalFound: edges.length,
      errorCount: errors.length,
    });

    return cors(
      json({
        success: errors.length === 0,
        deletedCount,
        skippedCount,
        totalFound: edges.length,
        errors,
        timestamp: nowIso,
      })
    );
  } catch (error) {
    console.error("CLEANUP ERROR:", error);

    logEvent({
      level: "error",
      action: "daily_cleanup_error",
      message: error?.message,
      stack: error?.stack,
    });

    checkErrorAlarm();

    return cors(
      json(
        {
          success: false,
          error: error?.messag,
        },
        { status: 500 }
      )
    );
  }
}
