import { describe, expect, it, vi } from 'vitest'
import { isFileDrag, useFileDrop } from './fileDrop'

function makeEvent(
  types: string[],
  files: File[] = [],
  extra: Record<string, unknown> = {},
): DragEvent {
  return {
    dataTransfer: { types, files, dropEffect: 'none' },
    currentTarget: null,
    relatedTarget: null,
    preventDefault: vi.fn(),
    ...extra,
  } as unknown as DragEvent
}

describe('fileDrop', () => {
  it('only treats file drags as drops', () => {
    expect(isFileDrag(makeEvent(['Files']))).toBe(true)
    expect(isFileDrag(makeEvent(['text/plain']))).toBe(false)
    expect(isFileDrag({ dataTransfer: null } as unknown as DragEvent)).toBe(false)
  })

  it('hands dropped files to the callback and stops the browser default', () => {
    const received: File[][] = []
    const { dragging, dropBinding } = useFileDrop((files) => received.push(files))
    const file = new File(['a'], 'a.txt')
    const event = makeEvent(['Files'], [file])

    dropBinding.onDragenter(event)
    expect(dragging.value).toBe(true)

    dropBinding.onDrop(event)
    expect(received).toHaveLength(1)
    expect(received[0][0].name).toBe('a.txt')
    expect(event.preventDefault).toHaveBeenCalled()
    expect(dragging.value).toBe(false)
  })

  it('ignores text drags', () => {
    const onFiles = vi.fn()
    const { dragging, dropBinding } = useFileDrop(onFiles)
    const event = makeEvent(['text/plain'])

    dropBinding.onDragenter(event)
    dropBinding.onDrop(event)
    expect(onFiles).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(dragging.value).toBe(false)
  })

  it('keeps the hint while dragging over child elements', () => {
    const { dragging, dropBinding } = useFileDrop(() => {})
    const child = { id: 'child' }
    const root = { contains: (node: unknown) => node === child }
    const overChild = makeEvent(['Files'], [], { currentTarget: root, relatedTarget: child })
    const leave = makeEvent(['Files'], [], { currentTarget: root, relatedTarget: null })

    dropBinding.onDragenter(makeEvent(['Files']))
    dropBinding.onDragleave(overChild)
    expect(dragging.value).toBe(true)

    dropBinding.onDragleave(leave)
    expect(dragging.value).toBe(false)
  })
})
