<script lang="ts">
  let { title = "Something went wrong", message }: { title?: string; message: string } = $props()
</script>

<div class="rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800">
  <div class="text-sm font-medium">{title}</div>
  <div class="mt-1 text-sm">{message}</div>
</div>
