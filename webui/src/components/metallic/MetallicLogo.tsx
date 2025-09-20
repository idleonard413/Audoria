import { useEffect, useState } from "react";
import MetallicPaint, { parseLogoImage } from "./MetallicPaint";
import logoAsset from "@/assets/logo.png";

const SHADER_PARAMS = {
  patternScale: 2.3,
  refraction: 0.018,
  edge: 1.4,
  patternBlur: 0.0045,
  liquid: 0.08,
  speed: 0.32,
};

export default function MetallicLogo() {
  const [imageData, setImageData] = useState<ImageData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadImage() {
      try {
        const response = await fetch(logoAsset);
        const blob = await response.blob();
        const file = new File([blob], "audoria-logo.png", { type: blob.type });
        const parsed = await parseLogoImage(file);
        if (!cancelled) {
          setImageData(parsed.imageData);
        }
      } catch (error) {
        console.error("Failed to prepare metallic logo", error);
      }
    }

    loadImage();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="glass-brand__emblem" aria-hidden="true">
      {imageData ? (
        <MetallicPaint imageData={imageData} params={SHADER_PARAMS} />
      ) : (
        <div className="glass-brand__emblem-fallback" />
      )}
    </div>
  );
}
