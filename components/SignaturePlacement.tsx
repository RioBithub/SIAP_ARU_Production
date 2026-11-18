"use client";

import { useRef, type PointerEvent } from "react";
import PdfPreview, { type DisplayedPage } from "@/components/PdfPreview";
import type { SignatureAnnotation } from "@/lib/mekari-sign";

const bound = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(value)));

function fittedBox(page: DisplayedPage, previous?: SignatureAnnotation | null) {
  const width = Math.max(1, Math.floor(page.width));
  const height = Math.max(1, Math.floor(page.height));
  const samePage = previous?.page === page.number ? previous : null;
  const w = bound(samePage ? samePage.element_width * width / samePage.canvas_width : width * .28, 1, width);
  const h = bound(samePage ? samePage.element_height * height / samePage.canvas_height : w * .32, 1, height);
  return {
    type_of: "signature", page: page.number, canvas_width: width, canvas_height: height,
    position_x: bound(samePage ? samePage.position_x * width / samePage.canvas_width : width * .1, 0, width - w),
    position_y: bound(samePage ? samePage.position_y * height / samePage.canvas_height : height * .73, 0, height - h),
    element_width: w, element_height: h,
  } as const;
}

type Drag = {
  id: number; kind: "move" | "size"; x: number; y: number;
  factorX: number; factorY: number; box: SignatureAnnotation;
};

export default function SignaturePlacement({ id, signerName, value, onChange }: {
  id: string; signerName: string; value: SignatureAnnotation | null;
  onChange: (value: SignatureAnnotation) => void;
}) {
  const drag = useRef<Drag | null>(null);
  return <PdfPreview id={id} title="Posisi tanda tangan pada PDF" overlay={page => {
    const box = fittedBox(page, value);
    const placed = value?.page === page.number;
    function start(event: PointerEvent<HTMLButtonElement>, kind: Drag["kind"]) {
      const paper = event.currentTarget.closest(".pdf-page")?.getBoundingClientRect();
      if (!paper?.width || !paper.height) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, kind, x: event.clientX, y: event.clientY,
        factorX: box.canvas_width / paper.width, factorY: box.canvas_height / paper.height, box };
    }
    function move(event: PointerEvent<HTMLButtonElement>) {
      const current = drag.current;
      if (current?.id !== event.pointerId) return;
      const original = current.box;
      const dx = (event.clientX - current.x) * current.factorX;
      const dy = (event.clientY - current.y) * current.factorY;
      onChange(current.kind === "size" ? {
        ...original,
        element_width: bound(original.element_width + dx, 1, original.canvas_width - original.position_x),
        element_height: bound(original.element_height + dy, 1, original.canvas_height - original.position_y),
      } : {
        ...original,
        position_x: bound(original.position_x + dx, 0, original.canvas_width - original.element_width),
        position_y: bound(original.position_y + dy, 0, original.canvas_height - original.element_height),
      });
    }
    const stop = () => { drag.current = null; };
    if (!placed) return <button type="button" className="btn btn-primary pdf-place-start" onClick={() => onChange(box)}>
      Pasang kotak di halaman {page.number}
    </button>;
    return <div className="signature-box" style={{
      left: box.position_x / box.canvas_width * 100 + "%",
      top: box.position_y / box.canvas_height * 100 + "%",
      width: box.element_width / box.canvas_width * 100 + "%",
      height: box.element_height / box.canvas_height * 100 + "%",
    }}>
      <button type="button" className="signature-box-move" aria-label={"Geser kotak " + signerName}
        onPointerDown={event => start(event, "move")} onPointerMove={move} onLostPointerCapture={stop}>
        {signerName}
      </button>
      <button type="button" className="signature-box-size" aria-label="Ubah ukuran kotak tanda tangan"
        onPointerDown={event => start(event, "size")} onPointerMove={move} onLostPointerCapture={stop}/>
    </div>;
  }}/>;
}
