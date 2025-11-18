import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server.js";
import { logEvent, checkErrorAlarm } from "../utils/logger.server.js";

const GET_EXISTING_TEMP_VARIANTS = `#graphql
  query GetExistingTempVariants($id: ID!) {
    product(id: $id) {
      variants(first: 100) {
        edges {
          node {
            id
            legacyResourceId
            displayName
            price
            metafields(first: 20) {
              edges {
                node {
                  namespace
                  key
                  value
                }
              }
            }
          }
        }
      }
    }
  }
`;

const CREATE_VARIANT_MUTATION = `#graphql
  mutation ProductVariantsCreate(
    $productId: ID!,
    $variants: [ProductVariantsBulkInput!]!
  ) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants {
        id
        legacyResourceId
        title
        price
        displayName
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_PRODUCT_OPTIONS = `#graphql
  query GetProduct($id: ID!) {
    product(id: $id) {
      options {
        name
        values
      }
    }
  }
`;

export async function action({ request }) {
  let cors = (res) => res;

  try {
    const auth = await authenticate.public.appProxy(request);
    const { admin } = auth;
    if (auth && typeof auth.cors === "function") {
      cors = auth.cors;
    }

    const body = await request.json();
    const { productId, calculatedPrice, materyalLabel, boy, en } = body;

    const variantTitle = `${boy}cm × ${en}cm - ${materyalLabel}`;
    const productGid = productId.includes("gid://")
      ? productId
      : `gid://shopify/Product/${productId}`;

    const createdAt = new Date();
    const deleteAt = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000);
    const nowIso = new Date().toISOString();

    logEvent({
      level: "info",
      action: "create_variant_started",
      productId: productGid,
      dimensions: variantTitle,
      price: calculatedPrice,
      time: nowIso,
    });

    const existingResponse = await admin.graphql(GET_EXISTING_TEMP_VARIANTS, {
      variables: { id: productGid },
    });

    const existingJson = await existingResponse.json();

    const variantEdges =
      existingJson.data?.product?.variants?.edges ?? [];

    const reusedEdge = variantEdges.find(({ node }) => {
      const metafields = node.metafields?.edges ?? [];

      const tempField = metafields.find(
        (m) =>
          m.node.namespace === "custom" &&
          m.node.key === "temporary"
      );
      const dimensionsField = metafields.find(
        (m) =>
          m.node.namespace === "custom" &&
          m.node.key === "dimensions"
      );

      const isTemporary = tempField?.node?.value === "true";
      const sameDimensions = dimensionsField?.node?.value === variantTitle;

      console.log("Checking existing variant:", {
        displayName: node.displayName,
        isTemporary,
        sameDimensions,
        tempValue: tempField?.node?.value,
        dimsValue: dimensionsField?.node?.value,
      });

      return isTemporary && sameDimensions;
    });

    if (reusedEdge) {
      const v = reusedEdge.node;

      console.log(
        "EXISTING TEMP VARIANT USED INSTEAD OF CREATING NEW ONE:",
        v.displayName
      );

      logEvent({
        level: "info",
        action: "variant_reused",
        productId: productGid,
        variantId: v.legacyResourceId,
        variantGid: v.id,
        dimensions: variantTitle,
        price: v.price,
      });

      return cors(
        json({
          success: true,
          reused: true,
          variantId: v.legacyResourceId,
          variantGid: v.id,
          title: v.displayName,
          price: v.price,
        })
      );
    }

    logEvent({
      level: "info",
      action: "variant_reuse_not_found",
      productId: productGid,
      dimensions: variantTitle,
    });

    const productResponse = await admin.graphql(GET_PRODUCT_OPTIONS, {
      variables: { id: productGid },
    });

    const productData = await productResponse.json();

    const firstOptionName =
      productData.data.product.options[0]?.name || "Title";

    const response = await admin.graphql(CREATE_VARIANT_MUTATION, {
      variables: {
        productId: productGid,
        variants: [
          {
            price: Number(calculatedPrice),
            inventoryPolicy: "CONTINUE",
            optionValues: [
              {
                name: variantTitle,
                optionName: firstOptionName,
              },
            ],
            metafields: [
              {
                namespace: "custom",
                key: "temporary",
                type: "boolean",
                value: "true",
              },
              {
                namespace: "custom",
                key: "created_at",
                type: "date_time",
                value: createdAt.toISOString(),
              },
              {
                namespace: "custom",
                key: "delete_at",
                type: "date_time",
                value: deleteAt.toISOString(),
              },
              {
                namespace: "custom",
                key: "dimensions",
                type: "single_line_text_field",
                value: variantTitle,
              },
            ],
          },
        ],
      },
    });

    const rawText = await response.text();

    let responseJson;
    try {
      responseJson = JSON.parse(rawText);
    } catch (e) {
      console.error("JSON parse error:", e);

      logEvent({
        level: "error",
        action: "create_variant_parse_error",
        message: e?.message,
      });
      checkErrorAlarm();

      return cors(
        json(
          {
            success: false,
            error: "Create variant JSON parse edilemedi",
          },
          { status: 500 }
        )
      );
    }

    const result = responseJson.data?.productVariantsBulkCreate;
    if (!result) {
      logEvent({
        level: "error",
        action: "create_variant_missing_result",
        response: responseJson,
      });
      checkErrorAlarm();

      return cors(
        json(
          {
            success: false,
            error: "productVariantsBulkCreate sonucu bulunamadı",
          },
          { status: 500 }
        )
      );
    }

    if (result.userErrors?.length) {
      console.error("UserErrors:", result.userErrors);

      logEvent({
        level: "error",
        action: "create_variant_user_errors",
        errors: result.userErrors,
      });
      checkErrorAlarm();

      return cors(
        json(
          {
            success: false,
            error: result.userErrors.map((e) => e.message).join(", "),
          },
          { status: 400 }
        )
      );
    }

    const newVariant = result.productVariants[0];

    console.log("NEW TEMP VARIANT CREATED:", {
      displayName: newVariant.displayName ?? newVariant.title,
      id: newVariant.legacyResourceId,
    });

    logEvent({
      level: "info",
      action: "variant_created",
      productId: productGid,
      variantId: newVariant.legacyResourceId,
      variantGid: newVariant.id,
      dimensions: variantTitle,
      price: calculatedPrice,
      createdAt: createdAt.toISOString(),
    });

    return cors(
      json({
        success: true,
        reused: false,
        variantId: newVariant.legacyResourceId,
        variantGid: newVariant.id,
        title: newVariant.displayName ?? newVariant.title,
        price: newVariant.price,
        deleteAt: deleteAt.toISOString(),
        createdAt: createdAt.toISOString(),
      })
    );
  } catch (error) {
    console.error("ERROR:", error);
    logEvent({
      level: "error",
      action: "create_variant_error",
      message: error?.message,
      stack: error?.stack,
    });
    checkErrorAlarm();

    return cors(
      json(
        {
          success: false,
          error: error?.message || "Sunucu hatası.",
        },
        { status: 500 }
      )
    );
  }
}
