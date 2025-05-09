import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface FileUploadProps {
  onValueChange: (files: File[]) => void;
  disabled?: boolean;
  maxFiles?: number;
  maxSize?: number;
  accept?: string;
  className?: string;
}

export function FileUpload({
  onValueChange,
  disabled = false,
  maxFiles = 1,
  maxSize = 5 * 1024 * 1024, // 5MB default
  accept,
  className,
}: FileUploadProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: any[]) => {
      // Handle rejected files
      if (rejectedFiles.length > 0) {
        const errors: string[] = [];
        rejectedFiles.forEach((file) => {
          file.errors.forEach((err: any) => {
            if (err.code === "file-too-large") {
              errors.push(`File "${file.file.name}" is too large. Max size is ${formatSize(maxSize)}.`);
            } else if (err.code === "file-invalid-type") {
              errors.push(`File "${file.file.name}" has an invalid type.`);
            } else {
              errors.push(`File "${file.file.name}": ${err.message}`);
            }
          });
        });
        setError(errors[0]);
        return;
      }

      // Reset error state
      setError(null);

      // Limit number of files
      const newFiles = acceptedFiles.slice(0, maxFiles);
      setFiles(newFiles);
      onValueChange(newFiles);
    },
    [maxFiles, maxSize, onValueChange]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    disabled,
    maxFiles,
    maxSize,
    accept: accept
      ? accept.split(",").reduce((acc: Record<string, string[]>, type) => {
          // Parse accept string like ".jpg,.png,.pdf"
          if (type.startsWith(".")) {
            // File extensions
            acc["application/octet-stream"] = [
              ...(acc["application/octet-stream"] || []),
              type,
            ];
          } else {
            // MIME types
            const [category, subtype] = type.split("/");
            if (!acc[category]) acc[category] = [];
            acc[category].push(subtype);
          }
          return acc;
        }, {})
      : undefined,
  });

  const removeFile = (index: number) => {
    const newFiles = [...files];
    newFiles.splice(index, 1);
    setFiles(newFiles);
    onValueChange(newFiles);
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors",
          isDragActive
            ? "border-primary bg-primary/5"
            : "border-input hover:border-primary/50 hover:bg-secondary/50",
          disabled && "opacity-50 cursor-not-allowed hover:border-input hover:bg-transparent",
          error && "border-destructive hover:border-destructive/50"
        )}
      >
        <input {...getInputProps()} />

        <div className="flex flex-col items-center gap-3">
          <div className="p-2 rounded-full bg-secondary/50">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-muted-foreground"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {isDragActive ? "Drop the files here" : "Upload file"}
            </p>
            <p className="text-xs text-muted-foreground">
              Drag and drop or click to browse
            </p>
            {!disabled && maxSize && (
              <p className="text-xs text-muted-foreground">
                Max file size: {formatSize(maxSize)}
              </p>
            )}
            {!disabled && accept && (
              <p className="text-xs text-muted-foreground">
                Accepted types: {accept}
              </p>
            )}
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-2 border rounded-md text-sm"
            >
              <div className="flex items-center space-x-2 truncate">
                <div className="p-1 rounded-md bg-secondary">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-muted-foreground"
                  >
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <div className="truncate">
                  <p className="truncate font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatSize(file.size)}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(index);
                }}
                disabled={disabled}
                className="h-8 w-8 flex-shrink-0"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-muted-foreground"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Helper to format file size
function formatSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}