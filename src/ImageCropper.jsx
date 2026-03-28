import { useEffect, useRef, useState } from "react";

export default function ImageCropper({ imageSrc, aspectRatio, onCancel, onConfirm }) {
  const [img, setImg] = useState(null);
  const [display, setDisplay] = useState({ w: 0, h: 0 });
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [zoomPercent, setZoomPercent] = useState(100);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, baseX: 0, baseY: 0 });
  const baseCropRef = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = imageSrc;
  }, [imageSrc]);

  useEffect(() => {
    if (!img) return;
    const maxW = window.innerWidth * 0.9;
    const maxH = window.innerHeight * 0.7;
    const r = img.width / img.height;
    let w = maxW;
    let h = w / r;
    if (h > maxH) {
      h = maxH;
      w = h * r;
    }
    setDisplay({ w, h });
    const targetR = aspectRatio === "16:9" ? 16 / 9 : 9 / 16;
    let cw = w;
    let ch = cw / targetR;
    if (ch > h) {
      ch = h;
      cw = ch * targetR;
    }
    baseCropRef.current = { w: cw, h: ch };
    setZoomPercent(100);
    setCrop({ x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch });
  }, [img, aspectRatio]);

  const onDown = (e) => {
    setDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: crop.x, baseY: crop.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    let x = dragRef.current.baseX + dx;
    let y = dragRef.current.baseY + dy;
    x = Math.max(0, Math.min(x, display.w - crop.w));
    y = Math.max(0, Math.min(y, display.h - crop.h));
    setCrop((p) => ({ ...p, x, y }));
  };

  const onUp = (e) => {
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const getMaxZoomPercent = () => {
    const base = baseCropRef.current;
    if (!base.w || !base.h) {
      return 400;
    }
    const minCropSide = 120;
    const maxByW = (base.w / minCropSide) * 100;
    const maxByH = (base.h / minCropSide) * 100;
    return Math.max(100, Math.floor(Math.min(maxByW, maxByH)));
  };

  const applyZoomPercent = (nextZoom) => {
    const minZoom = 100;
    const maxZoom = getMaxZoomPercent();
    const clampedZoom = Math.max(minZoom, Math.min(nextZoom, maxZoom));

    const base = baseCropRef.current;
    if (!base.w || !base.h) {
      return;
    }

    const ratio = aspectRatio === "16:9" ? 16 / 9 : 9 / 16;
    let w = base.w * (100 / clampedZoom);
    let h = w / ratio;
    if (w < 120 || h < 120) return;
    if (w > display.w || h > display.h) return;
    let x = crop.x - (w - crop.w) / 2;
    let y = crop.y - (h - crop.h) / 2;
    x = Math.max(0, Math.min(x, display.w - w));
    y = Math.max(0, Math.min(y, display.h - h));
    setCrop({ x, y, w, h });
    setZoomPercent(clampedZoom);
  };

  const zoomStep = (delta) => {
    applyZoomPercent(zoomPercent + delta);
  };

  const confirm = () => {
    if (!img) return;
    const canvas = document.createElement("canvas");
    const outW = aspectRatio === "16:9" ? 1920 : 1080;
    const outH = aspectRatio === "16:9" ? 1080 : 1920;
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    const sx = img.naturalWidth / display.w;
    const sy = img.naturalHeight / display.h;
    ctx.drawImage(img, crop.x * sx, crop.y * sy, crop.w * sx, crop.h * sy, 0, 0, outW, outH);
    onConfirm({
      croppedDataUrl: canvas.toDataURL("image/png"),
      crop: { x: Math.round(crop.x), y: Math.round(crop.y), w: Math.round(crop.w), h: Math.round(crop.h) }
    });
  };

  return (
    <div className="cropper-overlay">
      <div className="cropper-header">Adjust Crop ({aspectRatio})</div>
      <div className="cropper-stage" style={{ width: display.w, height: display.h }}>
        <img src={imageSrc} alt="source" />
        <div
          className="crop-box"
          style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        />
      </div>
      <div className="cropper-actions">
        <button className="icon-btn" onClick={() => zoomStep(-5)} aria-label="Zoom out">-</button>
        <input
          className="zoom-input"
          type="number"
          min={100}
          max={getMaxZoomPercent()}
          step={1}
          value={zoomPercent}
          onChange={(e) => {
            const v = Number(e.target.value || 100);
            setZoomPercent(v);
          }}
          onBlur={() => applyZoomPercent(Number(zoomPercent || 100))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              applyZoomPercent(Number(zoomPercent || 100));
            }
          }}
        />
        <span className="zoom-label">%</span>
        <button className="icon-btn" onClick={() => zoomStep(5)} aria-label="Zoom in">+</button>
        <button onClick={onCancel}>Cancel</button>
        <button onClick={confirm}>Confirm Crop</button>
      </div>
    </div>
  );
}
