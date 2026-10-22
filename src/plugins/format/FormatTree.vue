<script setup lang="ts">
import { ref } from 'vue'
import type { FormatTreeNode } from './tree'

const props = defineProps<{
  node: FormatTreeNode
  depth: number
  hoveredId: string | null
}>()

defineEmits<{
  hover: [node: FormatTreeNode]
  leave: []
}>()

const open = ref(props.depth < 2)

function onToggle(event: Event): void {
  open.value = (event.target as HTMLDetailsElement).open
}
</script>

<template>
  <details v-if="node.children?.length" class="ft-node" :open="open" @toggle="onToggle">
    <summary
      class="ft-row"
      :class="{ active: hoveredId === node.id }"
      @mouseenter="$emit('hover', node)"
      @mouseleave="$emit('leave')"
    >
      <span class="ft-name">{{ node.name }}</span>
      <span class="ft-kind">{{ node.kind }}</span>
      <span class="ft-preview">{{ node.preview }}</span>
    </summary>
    <div class="ft-children">
      <FormatTree
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :hovered-id="hoveredId"
        @hover="$emit('hover', $event)"
        @leave="$emit('leave')"
      />
    </div>
  </details>
  <div
    v-else
    class="ft-row ft-leaf"
    :class="{ active: hoveredId === node.id }"
    @mouseenter="$emit('hover', node)"
    @mouseleave="$emit('leave')"
  >
    <span class="ft-name">{{ node.name }}</span>
    <span class="ft-kind">{{ node.kind }}</span>
    <span class="ft-preview">{{ node.preview }}</span>
  </div>
</template>
