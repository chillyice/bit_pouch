import { ref } from 'vue'
import type { Ref } from 'vue'

export interface FileDropBinding {
  onDragenter: (event: DragEvent) => void
  onDragover: (event: DragEvent) => void
  onDragleave: (event: DragEvent) => void
  onDrop: (event: DragEvent) => void
}

export function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

/**
 * 把文件拖进工具页载入。只读本地 File，不写入任何存储。
 * 用法：`<div class="workbench" v-bind="dropBinding"><DropHint :visible="dragging" />`
 */
export function useFileDrop(onFiles: (files: File[]) => void): {
  dragging: Ref<boolean>
  dropBinding: FileDropBinding
} {
  const dragging = ref(false)

  function onDragenter(event: DragEvent): void {
    if (!isFileDrag(event)) return
    event.preventDefault()
    dragging.value = true
  }

  function onDragover(event: DragEvent): void {
    if (!isFileDrag(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  function onDragleave(event: DragEvent): void {
    const current = event.currentTarget as Node | null
    const next = event.relatedTarget as Node | null
    if (current && next && current.contains(next)) return
    dragging.value = false
  }

  function onDrop(event: DragEvent): void {
    dragging.value = false
    if (!isFileDrag(event)) return
    event.preventDefault()
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length) onFiles(files)
  }

  return { dragging, dropBinding: { onDragenter, onDragover, onDragleave, onDrop } }
}
