<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { basicSetup, EditorView } from 'codemirror'

const props = defineProps<{
  title: string
  text: string
  mode?: 'stdout' | 'stderr' | 'events' | 'json'
}>()

const host = ref<HTMLElement | null>(null)
const scrollParent = ref<HTMLElement | null>(null)
let editor: EditorView | null = null

const lines = computed(() => (props.text ? props.text.split('\n') : ['No log payload loaded.']))
const virtualizer = useVirtualizer(
  computed(() => ({
    count: lines.value.length,
    getScrollElement: () => scrollParent.value,
    estimateSize: () => 22,
    overscan: 10,
  })),
)
const virtualRows = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

function editorTheme() {
  return EditorView.theme({
    '&': {
      minHeight: '260px',
      maxHeight: '340px',
      backgroundColor: 'rgba(8, 9, 11, 0.96)',
      color: '#f7f1e8',
      fontSize: '12px',
    },
    '.cm-scroller': {
      fontFamily: 'JetBrains Mono, IBM Plex Mono, monospace',
    },
    '.cm-gutters': {
      backgroundColor: 'rgba(247, 241, 232, 0.04)',
      color: '#a99f99',
      border: 'none',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(88, 249, 255, 0.07)',
    },
    '.cm-content': {
      caretColor: '#58f9ff',
    },
  })
}

function mountEditor() {
  if (!host.value) return
  editor?.destroy()
  editor = new EditorView({
    doc: props.text || 'No log payload loaded.',
    extensions: [basicSetup, EditorView.editable.of(false), EditorView.lineWrapping, editorTheme()],
    parent: host.value,
  })
}

watch(
  () => props.text,
  (next) => {
    if (!editor) return
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: next || 'No log payload loaded.',
      },
    })
  },
)

onMounted(mountEditor)

onBeforeUnmount(() => {
  editor?.destroy()
  editor = null
})
</script>

<template>
  <article class="log-viewer" :class="`log-viewer--${mode ?? 'stdout'}`">
    <header>
      <div>
        <span>Professional Log Viewer</span>
        <strong>{{ title }}</strong>
      </div>
      <p>{{ lines.length }} lines · CodeMirror + virtual rail</p>
    </header>
    <div class="log-viewer__grid">
      <div ref="host" class="log-viewer__editor"></div>
      <div ref="scrollParent" class="log-viewer__virtual">
        <div :style="{ height: `${totalSize}px`, position: 'relative' }">
          <div
            v-for="row in virtualRows"
            :key="String(row.key)"
            class="log-viewer__line"
            :style="{ transform: `translateY(${row.start}px)` }"
          >
            <span>{{ row.index + 1 }}</span>
            <code>{{ lines[row.index] }}</code>
          </div>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.log-viewer {
  display: grid;
  gap: 12px;
}

.log-viewer header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 12px;
}

.log-viewer header span {
  display: block;
  color: var(--text-muted);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.log-viewer header strong {
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.log-viewer header p {
  color: var(--accent-cyan);
  font-family: var(--font-mono);
  font-size: 0.74rem;
}

.log-viewer__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(240px, 0.9fr);
  gap: 12px;
}

.log-viewer__editor,
.log-viewer__virtual {
  min-height: 260px;
  border: 1px solid rgba(247, 241, 232, 0.12);
  border-radius: var(--radius-xs);
  background: rgba(8, 9, 11, 0.96);
  overflow: hidden;
}

.log-viewer__virtual {
  max-height: 340px;
  overflow: auto;
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.log-viewer__line {
  position: absolute;
  left: 0;
  right: 0;
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  min-height: 22px;
  padding-right: 8px;
}

.log-viewer__line span {
  padding: 2px 8px;
  color: var(--text-muted);
  text-align: right;
  user-select: none;
}

.log-viewer__line code {
  min-width: 0;
  padding: 2px 0;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.log-viewer--stderr .log-viewer__line code {
  color: #ff9aa9;
}

@media (max-width: 980px) {
  .log-viewer__grid {
    grid-template-columns: 1fr;
  }
}
</style>
