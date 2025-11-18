import React from "react";
import ReactDOM from "react-dom/client";

export const CustomSizeForm = ({ productId }) => {
  const [boy, setBoy] = React.useState("");
  const [en, setEn] = React.useState("");
  const [materyal, setMateryal] = React.useState("");
  const [calculatedPrice, setCalculatedPrice] = React.useState(0);
  const [showPrice, setShowPrice] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState(null);
  const [status, setStatus] = React.useState("idle"); // idle | creatingVariant | addingToCart | success | error
  const [errorStep, setErrorStep] = React.useState(null); // "variant" | "cart" | "unknown"

  const MATERIAL_PRICES = {
    ahsap: { label: "Ahşap", basePrice: 50 },
    metal: { label: "Metal", basePrice: 120 },
    plastik: { label: "Plastik", basePrice: 30 },
  };

  const SIZE_COEFFICIENTS = [
    { maxArea: 0.5, coefficient: 1.0 },
    { maxArea: 1.0, coefficient: 1.1 },
    { maxArea: 2.0, coefficient: 1.2 },
    { maxArea: Infinity, coefficient: 1.3 },
  ];

  function getSizeCoefficient(areaInM2) {
    const row = SIZE_COEFFICIENTS.find((r) => areaInM2 <= r.maxArea);
    return row ? row.coefficient : 1;
  }

  React.useEffect(() => {
    if (boy && en && materyal) {
      const boyNum = parseFloat(boy);
      const enNum = parseFloat(en);

      if (
        Number.isNaN(boyNum) ||
        Number.isNaN(enNum) ||
        boyNum <= 0 ||
        enNum <= 0
      ) {
        setShowPrice(false);
        return;
      }

      const areaInMeters = (boyNum * enNum) / 10000;
      const sizeCoeff = getSizeCoefficient(areaInMeters);

      const materialConfig = MATERIAL_PRICES[materyal];
      const basePricePerM2 = materialConfig?.basePrice || 0;

      const total = areaInMeters * basePricePerM2 * sizeCoeff;

      setCalculatedPrice(total);
      setShowPrice(true);
    } else {
      setShowPrice(false);
    }
  }, [boy, en, materyal]);

  const handleAddToCart = async () => {
    if (loading || status === "creatingVariant" || status === "addingToCart") {
      return;
    }
    if (!boy || !en || !materyal) {
      setMessage({
        type: "error",
        text: "Please fill in the width, height, and material fields.",
      });
      setStatus("error");
      setErrorStep("variant");
      return;
    }

    setLoading(true);
    setMessage(null);
    setStatus("creatingVariant");
    setErrorStep(null);

    try {
      const createVariantResponse = await fetch("/apps/a/create-variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          calculatedPrice: calculatedPrice.toFixed(2),
          materyalLabel: MATERIAL_PRICES[materyal].label,
          boy,
          en,
        }),
      });

      const contentType =
        createVariantResponse.headers.get("content-type") || "";

      if (
        !createVariantResponse.ok ||
        !contentType.toLowerCase().includes("application/json")
      ) {
        const text = await createVariantResponse.text();
        console.error(
          "Create variant failed:",
          createVariantResponse.status,
          text,
        );
        setStatus("error");
        setErrorStep("variant");
        setMessage({
          type: "error",
          text: "An error occurred while creating the temporary product. Please try again or cancel.",
        });
        setLoading(false);
        return;
      }

      const variantData = await createVariantResponse.json();

      if (!variantData.success) {
        setStatus("error");
        setErrorStep("variant");
        setMessage({
          type: "error",
          text:
            variantData.error ||
            "The temporary product could not be created. Please try again or cancel.",
        });
        setLoading(false);
        return;
      }
      setStatus("addingToCart");

      const addToCartResponse = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              id: variantData.variantId,
              quantity: 1,
              properties: {
                Boy: `${boy} cm`,
                En: `${en} cm`,
                Materyal: MATERIAL_PRICES[materyal].label,
                Fiyat: `$${calculatedPrice.toFixed(2)}`,
              },
            },
          ],
        }),
      });
      if (variantData.reused) {
        setMessage({
          type: "info",
          text: "The existing temporary product was used for these measurements. The existing product was added to the cart.",
        });
      }

      if (!addToCartResponse.ok) {
        const errorText = await addToCartResponse.text();
        console.error("Cart error:", errorText);
        setStatus("error");
        setErrorStep("cart");
        setMessage({
          type: "error",
          text: "An error occurred while adding the product to the cart. Please try again or cancel.",
        });
        setLoading(false);
        return;
      }

      const cartData = await fetch("/cart.js").then((r) => r.json());
      const cartDrawer = document.querySelector("cart-drawer");
      if (cartDrawer) {
        try {
          const drawerResponse = await fetch("/cart?view=drawer");
          const drawerHTML = await drawerResponse.text();

          const parser = new DOMParser();
          const doc = parser.parseFromString(drawerHTML, "text/html");
          const newDrawer = doc.querySelector("cart-drawer");

          if (newDrawer) {
            cartDrawer.innerHTML = newDrawer.innerHTML;
          }

          if (typeof cartDrawer.open === "function") {
            cartDrawer.open();
          } else {
            cartDrawer.setAttribute("open", "");
            cartDrawer.classList.add("is-open", "active");
          }
        } catch (e) {
          console.error("Cart drawer refresh error:", e);
        }
      } else {
        const cartNotification = document.querySelector("cart-notification");
        if (
          cartNotification &&
          typeof cartNotification.renderContents === "function"
        ) {
          cartNotification.renderContents(cartData);
          if (typeof cartNotification.open === "function") {
            cartNotification.open();
          }
        }
      }

      document.dispatchEvent(
        new CustomEvent("theme:cart:update", {
          detail: { cart: cartData },
        }),
      );
      document.dispatchEvent(
        new CustomEvent("cart:updated", { detail: { cart: cartData } }),
      );

      const badge =
        document.querySelector("[data-cart-count]") ||
        document.querySelector(".cart-count-bubble");

      if (badge) {
        badge.textContent = cartData.item_count;
        const wrapper = badge.closest(".cart-count-bubble");
        if (wrapper) wrapper.classList.remove("hidden");
      }

      setStatus("success");
      setMessage({
        type: "success",
        text: `✅ Ürün sepete eklendi! (${boy}cm × ${en}cm - ${
          MATERIAL_PRICES[materyal].label
        })`,
      });

      setTimeout(() => {
        setBoy("");
        setEn("");
        setMateryal("");
        setMessage(null);
        setStatus("idle");
      }, 3000);
    } catch (error) {
      console.error("Error:", error);
      setStatus("error");
      setErrorStep("unknown");
      setMessage({
        type: "error",
        text: "An unexpected error occurred. Please try again or cancel.",
      });
    } finally {
      setLoading(false);
    }
  };

  const styles = {
    container: {
      padding: "20px",
      border: "2px solid #e0e0e0",
      borderRadius: "8px",
      backgroundColor: "#fff",
      maxWidth: "500px",
      marginTop: "20px",
    },
    title: { marginTop: 0, marginBottom: "20px", fontSize: "1.5rem" },
    formField: { marginBottom: "15px" },
    label: { display: "block", marginBottom: "5px", fontWeight: "bold" },
    input: {
      width: "100%",
      padding: "10px",
      borderRadius: "4px",
      border: "1px solid #ddd",
      boxSizing: "border-box",
      fontSize: "1rem",
    },
    select: {
      width: "100%",
      padding: "10px",
      borderRadius: "4px",
      border: "1px solid #ddd",
      boxSizing: "border-box",
      fontSize: "1rem",
    },
    priceBox: {
      padding: "15px",
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      borderRadius: "8px",
      color: "white",
      marginBottom: "15px",
      textAlign: "center",
    },
    priceValue: { fontSize: "2rem", fontWeight: "bold" },
    message: {
      padding: "12px",
      borderRadius: "4px",
      marginBottom: "15px",
      fontWeight: "500",
    },
    button: {
      width: "100%",
      padding: "15px",
      backgroundColor: "#000",
      color: "#fff",
      border: "none",
      borderRadius: "4px",
      fontSize: "1rem",
      fontWeight: "bold",
      cursor: "pointer",
    },
    buttonDisabled: {
      width: "100%",
      padding: "15px",
      backgroundColor: "#ccc",
      color: "#fff",
      border: "none",
      borderRadius: "4px",
      fontSize: "1rem",
      cursor: "not-allowed",
    },
    subtleStatus: {
      fontSize: "0.9rem",
      color: "#555",
      marginBottom: "8px",
    },
    inlineButtons: {
      marginTop: "8px",
      display: "flex",
      gap: "8px",
      flexWrap: "wrap",
    },
    retryButton: {
      padding: "8px 12px",
      borderRadius: "4px",
      border: "none",
      backgroundColor: "#000",
      color: "#fff",
      fontSize: "0.9rem",
      cursor: "pointer",
    },
    cancelButton: {
      padding: "8px 12px",
      borderRadius: "4px",
      border: "1px solid #ccc",
      backgroundColor: "#fff",
      color: "#333",
      fontSize: "0.9rem",
      cursor: "pointer",
    },
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Select Custom Size</h3>

      <div style={styles.formField}>
        <label style={styles.label}>Height :</label>
        <input
          type="number"
          value={boy}
          onChange={(e) => setBoy(e.target.value)}
          placeholder="exp: 100"
          style={styles.input}
        />
      </div>

      <div style={styles.formField}>
        <label style={styles.label}>Width :</label>
        <input
          type="number"
          value={en}
          onChange={(e) => setEn(e.target.value)}
          placeholder="exp: 80"
          style={styles.input}
        />
      </div>

      <div style={styles.formField}>
        <label style={styles.label}>Materiel:</label>
        <select
          value={materyal}
          onChange={(e) => setMateryal(e.target.value)}
          style={styles.select}
        >
          <option value="">Select</option>
          <option value="ahsap">
            Ahşap (${MATERIAL_PRICES.ahsap.basePrice}/m²)
          </option>
          <option value="metal">
            Metal (${MATERIAL_PRICES.metal.basePrice}/m²)
          </option>
          <option value="plastik">
            Plastik (${MATERIAL_PRICES.plastik.basePrice}/m²)
          </option>
        </select>
      </div>

      {showPrice && (
        <div style={styles.priceBox}>
          <div style={styles.priceValue}>${calculatedPrice.toFixed(2)}</div>
        </div>
      )}

      {status === "creatingVariant" && (
        <p style={styles.subtleStatus}>
          Creating temporary product, please wait...
        </p>
      )}
      {status === "addingToCart" && (
        <p style={styles.subtleStatus}>
          Adding product to cart, please wait...
        </p>
      )}

      {message && (
        <div
          style={{
            ...styles.message,
            backgroundColor: message.type === "error" ? "#ffebee" : "#e8f5e9",
            color: message.type === "error" ? "#c62828" : "#2e7d32",
          }}
        >
          <div>{message.text}</div>

          {status === "error" && (
            <div style={styles.inlineButtons}>
              <button
                type="button"
                onClick={handleAddToCart}
                style={styles.retryButton}
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={() => {
                  setStatus("idle");
                  setMessage(null);
                  setErrorStep(null);
                }}
                style={styles.cancelButton}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleAddToCart}
        disabled={loading}
        style={loading ? styles.buttonDisabled : styles.button}
      >
        {loading ? "Processing..." : "Add to Cart"}
      </button>
    </div>
  );
};

function initCustomSizeForm() {
  const rootElement = document.getElementById("custom-size-app-root");
  if (rootElement) {
    const productId = rootElement.dataset.productId;
    const root = ReactDOM.createRoot(rootElement);
    root.render(<CustomSizeForm productId={productId} />);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCustomSizeForm);
} else {
  initCustomSizeForm();
}
