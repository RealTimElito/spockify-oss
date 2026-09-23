<script lang="ts">
	import { WEBUI_BASE_URL } from '$lib/constants';
	import { safeImageUrl } from '$lib/utils/safeImageUrl';

	export let src = '';
	export let className = 'rounded-lg max-h-96';

	let _src = '';
	$: _src = safeImageUrl(src.startsWith('/') ? `${WEBUI_BASE_URL}${src}` : src);
</script>

<div class="relative group w-fit flex items-center">
	<!-- svelte-ignore a11y-media-has-caption -->
	<video src={_src} class={className} controls preload="metadata" data-cy="video">
		<track kind="captions" />
	</video>
</div>
