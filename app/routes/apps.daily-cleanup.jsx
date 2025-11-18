import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { logEvent, checkErrorAlarm } from "../utils/logger.server.js";

const GET_ALL_TEMP_VARIANTS = `#graphql
  query GetAllTempVariants {
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

    const now = new Date();
    const nowIso = now.toISOString();
    const threshold24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
     logEvent({
      level: "info",
      action: "daily_cleanup_started",
      timestamp: nowIso,
      threshold24h,
    });

    const variantsResponse = await admin.graphql(GET_ALL_TEMP_VARIANTS);
    const variantsData = await variantsResponse.json();

    const edges = variantsData.data?.productVariants?.edges ?? [];

    let deletedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const { node } of edges) {
      const metafields = node.metafields?.edges ?? [];

      const deleteAtField = metafields.find(
        (m) => m.node.key === "delete_at"
      );
      const createdAtField = metafields.find(
        (m) => m.node.key === "created_at"
      );

      const deleteAt = deleteAtField?.node?.value;
      const createdAt = createdAtField?.node?.value;

      const isExpiredByDeleteAt = deleteAt && deleteAt < nowIso;
      const isOlderThan24h = createdAt && createdAt < threshold24h;

      console.log(`DAILY CHECK ${node.displayName}`);
      console.log(`created_at: ${createdAt}`);
      console.log(`delete_at : ${deleteAt}`);
      console.log(`expiredByDeleteAt: ${isExpiredByDeleteAt}`);
      console.log(`olderThan24h     : ${isOlderThan24h}`);

      if (!isExpiredByDeleteAt && !isOlderThan24h) {
        skippedCount++;
        continue;
      }

      console.log(`DELETE: ${node.displayName}`);

      const deleteResponse = await admin.graphql(PRODUCT_VARIANTS_BULK_DELETE, {
        variables: {
          productId: node.product.id,
          variantsIds: [node.id],
        },
      });

       const deleteJson = await deleteResponse.json();
      const result = deleteJson.data?.productVariantsBulkDelete;

      if (!result || (result.userErrors && result.userErrors.length > 0)) {
        const errDetail =
          result?.userErrors || deleteJson.errors || [];

        console.error("Daily delete error:", errDetail);

        errors.push({
          variant: node.displayName,
          errors: errDetail,
        });

        logEvent({
          level: "error",
          action: "daily_cleanup_delete_error",
          variantName: node.displayName,
          productId: node.product.id,
          errors: errDetail,
        });

        checkErrorAlarm();
      } else {
        console.log(` DELETED: ${node.displayName}`);
        deletedCount++;
         logEvent({
          level: "info",
          action: "daily_cleanup_deleted",
          variantName: node.displayName,
          productId: node.product.id,
        });
      }
    }

    console.log("DAILY CLEANUP SUMMARY", {
      deletedCount,
      skippedCount,
      totalFound: edges.length,
      errorsCount: errors.length,
    });
     logEvent({
      level: "info",
      action: "daily_cleanup_finished",
      timestamp: nowIso,
      totalFound: edges.length,
      deletedCount,
      skippedCount,
      errorsCount: errors.length,
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
    console.error("DAILY CLEANUP ERROR:", error);
    return cors(
      json(
        {
          success: false,
          error: error.message,
        },
        { status: 500 }
      )
    );
  }
}
