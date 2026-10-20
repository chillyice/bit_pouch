<script setup lang="ts">
import { computed } from 'vue'
import type { Component } from 'vue'
import {
  Binary,
  Braces,
  CaseSensitive,
  Clock,
  CodeXml,
  EthernetPort,
  FileSearch,
  FileText,
  Fingerprint,
  Hash,
  Image,
  KeyRound,
  Link,
  Network,
  Palette,
  Regex,
  Ruler,
  Terminal,
  Wrench,
} from 'lucide-vue-next'

const props = withDefaults(defineProps<{ name: string; size?: number; strokeWidth?: number }>(), {
  size: 20,
  strokeWidth: 1.9,
})

const icons: Record<string, Component> = {
  braces: Braces,
  binary: Binary,
  'case-sensitive': CaseSensitive,
  clock: Clock,
  code: CodeXml,
  'ethernet-port': EthernetPort,
  fingerprint: Fingerprint,
  hash: Hash,
  key: KeyRound,
  link: Link,
  network: Network,
  regex: Regex,
  text: FileText,
  palette: Palette,
  ruler: Ruler,
  image: Image,
  'file-search': FileSearch,
  terminal: Terminal,
  pdf: FileText,
  wrench: Wrench,
}

const resolved = computed(() => icons[props.name] ?? Wrench)
</script>

<template>
  <component :is="resolved" :size="size" :stroke-width="strokeWidth" aria-hidden="true" />
</template>
