<script lang="ts">
  interface Props {
    tone: "danger" | "warning";
    title: string;
    message: string;
  }

  let { tone, title, message }: Props = $props();
</script>

<div class="banner {tone}" role="alert">
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M10 3l8 14H2z" />
    <path d="M10 8.5v3.5M10 14.5v.01" />
  </svg>
  <div>
    <strong>{title}</strong>
    <span>{message}</span>
  </div>
</div>

<style>
  .banner {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
    border: 1px solid;
    border-radius: 12px;
    font-size: 13.5px;
  }

  .danger {
    border-color: var(--danger-line);
    background: var(--danger-weak);
  }

  .warning {
    border-color: color-mix(in srgb, var(--warning-text) 30%, transparent);
    background: var(--warning-weak);
    color: var(--warning-text);
  }

  svg {
    flex: none;
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .danger svg {
    color: var(--danger);
  }

  strong {
    display: block;
  }

  span {
    color: var(--text-2);
  }

  .warning span {
    color: inherit;
  }
</style>
