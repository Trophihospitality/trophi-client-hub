import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Slider } from '@/components/ui/slider';
import {
  loadImageFromFile,
  renderCroppedSquareJpeg,
  validateAvatarFile,
  type CropTransform,
} from '@/lib/avatar';

/**
 * Square crop dialog. User can drag to reposition and zoom with a slider.
 * Confirming returns the cropped 512x512 JPEG blob (with an object-URL preview).
 */
export function AvatarCropDialog({
  file,
  onCancel,
  onConfirm,
}: {
  file: File;
  onCancel: () => void;
  onConfirm: (blob: Blob, previewUrl: string) => void;
}) {
  const VIEW = 288; // square crop viewport, CSS px

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const baseScale = useMemo(() => {
    if (!img) return 1;
    return Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight);
  }, [img]);

  // Load & center the image on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const el = await loadImageFromFile(file);
        if (!alive) return;
        setImg(el);
        const base = Math.max(VIEW / el.naturalWidth, VIEW / el.naturalHeight);
        const dw = el.naturalWidth * base;
        const dh = el.naturalHeight * base;
        setZoom(1);
        setOffset({ x: (VIEW - dw) / 2, y: (VIEW - dh) / 2 });
      } catch {
        toast.error('Could not read that image');
        onCancel();
      }
    })();
    return () => { alive = false; };
  }, [file, onCancel]);

  // Clamp offset so the image always covers the viewport (no gaps).
  function clampOffset(nx: number, ny: number, z = zoom) {
    if (!img) return { x: nx, y: ny };
    const dw = img.naturalWidth * baseScale * z;
    const dh = img.naturalHeight * baseScale * z;
    const minX = VIEW - dw;
    const minY = VIEW - dh;
    return {
      x: Math.min(0, Math.max(minX, nx)),
      y: Math.min(0, Math.max(minY, ny)),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    setOffset(clampOffset(d.ox + (e.clientX - d.x), d.oy + (e.clientY - d.y)));
  }
  function onPointerUp() { dragRef.current = null; }

  function onZoomChange(next: number) {
    if (!img) return setZoom(next);
    // Keep the viewport center anchored while zooming.
    const cx = VIEW / 2;
    const cy = VIEW / 2;
    const imgCxOld = (cx - offset.x) / (baseScale * zoom);
    const imgCyOld = (cy - offset.y) / (baseScale * zoom);
    const newOx = cx - imgCxOld * baseScale * next;
    const newOy = cy - imgCyOld * baseScale * next;
    setZoom(next);
    setOffset(clampOffset(newOx, newOy, next));
  }

  async function handleConfirm() {
    if (!img) return;
    setSaving(true);
    try {
      const t: CropTransform = {
        imageWidth: img.naturalWidth,
        imageHeight: img.naturalHeight,
        viewSize: VIEW,
        zoom,
        offsetX: offset.x,
        offsetY: offset.y,
      };
      const blob = await renderCroppedSquareJpeg(img, t, 512, 0.9);
      // Re-run the size guard against the cropped output (should always pass; belt-and-suspenders).
      const v = validateAvatarFile(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
      if (!v.ok) throw new Error(v.error);
      onConfirm(blob, URL.createObjectURL(blob));
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not crop image');
    } finally {
      setSaving(false);
    }
  }

  const dw = img ? img.naturalWidth * baseScale * zoom : 0;
  const dh = img ? img.naturalHeight * baseScale * zoom : 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-semibold mb-1">Crop your photo</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Drag to reposition and use the slider to zoom. What's inside the circle is what gets saved.
        </p>

        <div className="flex justify-center">
          <div
            className="relative overflow-hidden rounded-full bg-muted/60 select-none touch-none cursor-grab active:cursor-grabbing"
            style={{ width: VIEW, height: VIEW }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {img && (
              <img
                src={img.src}
                alt=""
                draggable={false}
                className="absolute top-0 left-0 max-w-none pointer-events-none"
                style={{ width: dw, height: dh, transform: `translate(${offset.x}px, ${offset.y}px)` }}
              />
            )}
          </div>
        </div>

        <div className="mt-5">
          <div className="text-xs text-muted-foreground mb-2">Zoom</div>
          <Slider
            min={1}
            max={4}
            step={0.01}
            value={[zoom]}
            onValueChange={(v) => onZoomChange(v[0] ?? 1)}
          />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-input px-3.5 py-2 text-sm">Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!img || saving}
            className="rounded-md bg-[hsl(var(--trophi-gold))] px-3.5 py-2 text-sm font-medium text-[hsl(var(--trophi-ink))] disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Use photo'}
          </button>
        </div>
      </div>
    </div>
  );
}
