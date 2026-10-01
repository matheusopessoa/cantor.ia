"use client";

import { useState, type ChangeEvent, type DragEvent } from "react";
import { UploadIcon } from "./icons";

interface FileDropzoneProps {
  title: string;
  description: string;
  busy?: boolean;
  busyLabel?: string;
  onFile: (file: File) => void;
}

/** `.ct-dropzone`: clique ou arraste um arquivo de áudio. */
export function FileDropzone({ title, description, busy = false, busyLabel = "Enviando", onFile }: FileDropzoneProps) {
  const [dragover, setDragover] = useState(false);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file && !busy) onFile(file);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragover(false);
    const file = event.dataTransfer.files?.[0];
    if (file && !busy) onFile(file);
  };

  return (
    <label
      className={`ct-dropzone${dragover ? " is-dragover" : ""}`}
      aria-busy={busy}
      onDragOver={(event) => {
        event.preventDefault();
        if (!busy) setDragover(true);
      }}
      onDragLeave={() => setDragover(false)}
      onDrop={handleDrop}
    >
      <UploadIcon />
      <strong className="font-marquee uppercase text-fg">{busy ? `${busyLabel}…` : title}</strong>
      <span>{description}</span>
      <input type="file" accept="audio/*" className="ct-sr-only" disabled={busy} onChange={handleChange} />
    </label>
  );
}
