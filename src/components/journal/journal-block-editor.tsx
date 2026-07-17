"use client";

import { Button } from "@/components/ui/button";
import { ProductImageDropzone } from "@/components/products/product-image-dropzone";
import type { JournalBlock } from "@/lib/journal-db";
import { ArrowDown, ArrowUp, Heading2, Image as ImageIcon, Pilcrow, Quote, Trash2 } from "lucide-react";

/** 日誌插圖與主圖共用的 Storage bucket */
export const JOURNAL_IMAGES_BUCKET = "journal-images";

const BLOCK_LABEL: Record<JournalBlock["type"], string> = {
  paragraph: "段落",
  heading: "小標",
  quote: "引言",
  image: "圖片",
};

export interface JournalBlockEditorProps {
  value: JournalBlock[];
  onChange: (blocks: JournalBlock[]) => void;
  disabled?: boolean;
  /** 給欄位 id / aria 用的前綴，避免中英文兩份編輯器 id 重複 */
  idPrefix: string;
}

/** 日誌內文的區塊編輯器：段落／小標／引言／圖片，可增刪與上下移動 */
export function JournalBlockEditor({ value, onChange, disabled = false, idPrefix }: JournalBlockEditorProps) {
  function updateBlock(index: number, block: JournalBlock) {
    onChange(value.map((b, i) => (i === index ? block : b)));
  }

  function removeBlock(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function moveBlock(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= value.length) return;
    const next = [...value];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function addBlock(type: JournalBlock["type"]) {
    onChange([...value, type === "image" ? { type: "image", url: "" } : { type, text: "" }]);
  }

  const textareaClass =
    "rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y";
  const inputClass =
    "h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          尚無內容，請用下方按鈕加入段落或圖片。
        </p>
      )}

      {value.map((block, index) => (
        <div key={index} className="rounded-lg border border-border bg-muted/10">
          <div className="flex items-center gap-1 border-b border-border bg-muted/20 px-3 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {index + 1}. {BLOCK_LABEL[block.type]}
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={disabled || index === 0}
                onClick={() => moveBlock(index, -1)}
                aria-label={`第 ${index + 1} 區塊上移`}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={disabled || index === value.length - 1}
                onClick={() => moveBlock(index, 1)}
                aria-label={`第 ${index + 1} 區塊下移`}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                disabled={disabled}
                onClick={() => removeBlock(index)}
                aria-label={`刪除第 ${index + 1} 區塊`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="p-3">
            {block.type === "paragraph" && (
              <textarea
                value={block.text}
                onChange={(e) => updateBlock(index, { type: "paragraph", text: e.target.value })}
                rows={4}
                disabled={disabled}
                className={`${textareaClass} min-h-[80px] w-full`}
                placeholder="段落文字"
                aria-label={`${idPrefix} 第 ${index + 1} 區塊段落文字`}
              />
            )}
            {block.type === "heading" && (
              <input
                type="text"
                value={block.text}
                onChange={(e) => updateBlock(index, { type: "heading", text: e.target.value })}
                disabled={disabled}
                className={`${inputClass} w-full font-medium`}
                placeholder="小標文字"
                aria-label={`${idPrefix} 第 ${index + 1} 區塊小標文字`}
              />
            )}
            {block.type === "quote" && (
              <textarea
                value={block.text}
                onChange={(e) => updateBlock(index, { type: "quote", text: e.target.value })}
                rows={2}
                disabled={disabled}
                className={`${textareaClass} min-h-[56px] w-full italic`}
                placeholder="引言文字"
                aria-label={`${idPrefix} 第 ${index + 1} 區塊引言文字`}
              />
            )}
            {block.type === "image" && (
              <div className="flex flex-col gap-2">
                <ProductImageDropzone
                  bucket={JOURNAL_IMAGES_BUCKET}
                  value={block.url || null}
                  onChange={(url) =>
                    updateBlock(index, { type: "image", url: url ?? "", caption: block.caption })
                  }
                  disabled={disabled}
                />
                <input
                  type="text"
                  value={block.caption ?? ""}
                  onChange={(e) =>
                    updateBlock(index, {
                      type: "image",
                      url: block.url,
                      caption: e.target.value || undefined,
                    })
                  }
                  disabled={disabled}
                  className={`${inputClass} w-full`}
                  placeholder="圖說（選填）"
                  aria-label={`${idPrefix} 第 ${index + 1} 區塊圖說`}
                />
              </div>
            )}
          </div>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="h-8 gap-1.5 px-3 text-xs" disabled={disabled} onClick={() => addBlock("paragraph")}>
          <Pilcrow className="h-3.5 w-3.5" />
          段落
        </Button>
        <Button type="button" variant="outline" className="h-8 gap-1.5 px-3 text-xs" disabled={disabled} onClick={() => addBlock("heading")}>
          <Heading2 className="h-3.5 w-3.5" />
          小標
        </Button>
        <Button type="button" variant="outline" className="h-8 gap-1.5 px-3 text-xs" disabled={disabled} onClick={() => addBlock("quote")}>
          <Quote className="h-3.5 w-3.5" />
          引言
        </Button>
        <Button type="button" variant="outline" className="h-8 gap-1.5 px-3 text-xs" disabled={disabled} onClick={() => addBlock("image")}>
          <ImageIcon className="h-3.5 w-3.5" />
          圖片
        </Button>
      </div>
    </div>
  );
}
