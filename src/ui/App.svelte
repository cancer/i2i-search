<script module lang="ts">
  let searchSeq = 0;
</script>

<script lang="ts">
  type Product = {
    id: string;
    name: string;
    category: string;
    image: string;
    price: number;
    sizes: string[];
    color: string;
    spec: string;
    description?: string;
  };

  type SearchResult = {
    id: string;
    name: string;
    category: string;
    image: string;
    description?: string;
    price?: number;
    sizes?: string[];
    color?: string;
    score?: number;
  };

  type FilterMetadata = {
    price?: number;
    sizes?: string[];
    color?: string;
  };

  type Size = "S" | "M" | "L";
  type Color = "black" | "white" | "gray" | "brown" | "red" | "blue" | "green" | "beige";

  const availableSizes: readonly Size[] = ["S", "M", "L"];
  const availableColors: readonly Color[] = [
    "black",
    "white",
    "gray",
    "brown",
    "red",
    "blue",
    "green",
    "beige",
  ];
  const colorLabels: Record<Color, string> = {
    black: "黒",
    white: "白",
    gray: "灰",
    brown: "茶",
    red: "赤",
    blue: "青",
    green: "緑",
    beige: "ベージュ",
  };
  const colorSwatches: Record<Color, string> = {
    black: "#24211f",
    white: "#fffdf8",
    gray: "#9d9b98",
    brown: "#8a5b3d",
    red: "#b84a3c",
    blue: "#4f6fae",
    green: "#5f8d5a",
    beige: "#d6c0a0",
  };

  type SearchMode = "keyword" | "image";

  let products = $state<Product[]>([]);
  let productsById = $derived(new Map(products.map((product) => [product.id, product])));
  let keywordText = $state("");
  let keywordQuery = $derived(keywordText.trim());
  let results = $state<SearchResult[]>([]);
  let searchMode = $state<SearchMode>("keyword");
  let minimumPriceText = $state("");
  let maximumPriceText = $state("");
  let selectedSizes = $state<Size[]>([]);
  let selectedColors = $state<Color[]>([]);
  let minimumPrice = $derived(parsePrice(minimumPriceText));
  let maximumPrice = $derived(parsePrice(maximumPriceText));
  let hasMetadataFilters = $derived(
    minimumPriceText.trim() !== ""
      || maximumPriceText.trim() !== ""
      || selectedSizes.length > 0
      || selectedColors.length > 0,
  );
  let matchesFilters = $derived.by(() => {
    const activeSizes = [...selectedSizes];
    const activeColors = [...selectedColors];
    const lowerPrice = minimumPrice;
    const upperPrice = maximumPrice;

    return (metadata: FilterMetadata): boolean =>
      (lowerPrice === undefined || (metadata.price !== undefined && metadata.price >= lowerPrice))
      && (upperPrice === undefined || (metadata.price !== undefined && metadata.price <= upperPrice))
      && (activeSizes.length === 0
        || (metadata.sizes !== undefined && activeSizes.some((size) => metadata.sizes?.includes(size))))
      && (activeColors.length === 0
        || (metadata.color !== undefined && activeColors.includes(metadata.color as Color)));
  });
  let filteredProducts = $derived<SearchResult[]>(
    products
      .filter((product) => matchesFilters(product))
      .map((product) => ({
        id: product.id,
        name: product.name,
        category: product.category,
        image: product.image,
      })),
  );
  let filteredResults = $derived<SearchResult[]>(
    results.filter((result) => {
      const product = productsById.get(result.id);
      return matchesFilters({
        price: result.price ?? product?.price,
        sizes: result.sizes ?? product?.sizes,
        color: result.color ?? product?.color,
      });
    }),
  );
  let displayedResults = $derived<SearchResult[]>(
    searchMode === "image" || keywordQuery !== ""
      ? filteredResults
      : hasMetadataFilters
        ? filteredProducts
        : [],
  );
  let loadingProducts = $state(true);
  let loadingSearch = $state(false);
  let dragging = $state(false);
  let errorMessage = $state("");
  let selectedFileName = $state("");

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  function isSize(value: unknown): value is Size {
    return typeof value === "string" && availableSizes.includes(value as Size);
  }

  function isColor(value: unknown): value is Color {
    return typeof value === "string" && availableColors.includes(value as Color);
  }

  function parsePrice(value: string): number | undefined {
    if (value.trim() === "") {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function getColorLabel(color: string): string {
    return isColor(color) ? colorLabels[color] : color;
  }

  function getColorSwatch(color: string): string {
    return isColor(color) ? colorSwatches[color] : "#8a8178";
  }

  function isProduct(value: unknown): value is Product {
    return isRecord(value)
      && typeof value.id === "string"
      && typeof value.name === "string"
      && typeof value.category === "string"
      && typeof value.image === "string"
      && typeof value.price === "number"
      && Number.isFinite(value.price)
      && Array.isArray(value.sizes)
      && value.sizes.length > 0
      && value.sizes.every(isSize)
      && isColor(value.color)
      && typeof value.spec === "string";
  }

  function isSearchResult(value: unknown): value is SearchResult {
    return isRecord(value)
      && typeof value.id === "string"
      && typeof value.name === "string"
      && typeof value.category === "string"
      && typeof value.image === "string"
      && typeof value.score === "number"
      && Number.isFinite(value.score)
      && (value.description === undefined || typeof value.description === "string")
      && (value.price === undefined
        || (typeof value.price === "number" && Number.isFinite(value.price)))
      && (value.sizes === undefined
        || (Array.isArray(value.sizes) && value.sizes.every((size) => typeof size === "string")))
      && (value.color === undefined || typeof value.color === "string");
  }

  function isProductList(value: unknown): value is Product[] {
    return Array.isArray(value) && value.every(isProduct);
  }

  function isSearchResponse(value: unknown): value is { results: SearchResult[] } {
    return isRecord(value) && Array.isArray(value.results) && value.results.every(isSearchResult);
  }

  function getErrorMessage(value: unknown, fallback: string): string {
    return isRecord(value) && typeof value.error === "string" ? value.error : fallback;
  }

  function getImageTitle(product: Product): string {
    return `${product.name} — ${product.spec}`;
  }

  async function loadProducts(): Promise<void> {
    loadingProducts = true;
    try {
      const response = await fetch("/api/products");
      const payload: unknown = await response.json();
      if (!response.ok || !isProductList(payload)) {
        throw new Error("商品一覧を読み込めませんでした。");
      }
      products = payload;
    } catch {
      errorMessage = "商品一覧を読み込めませんでした。";
    } finally {
      loadingProducts = false;
    }
  }

  function isSupportedImage(file: File): boolean {
    return file.type === "image/png" || file.type === "image/jpeg";
  }

  function handleKeywordInput(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    keywordText = input.value;
    searchMode = "keyword";
    ++searchSeq;
    results = [];
    loadingSearch = false;
    errorMessage = "";
    selectedFileName = "";
  }

  function handleKeywordKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      void searchKeyword();
    }
  }

  function handleMinimumPriceInput(event: Event): void {
    minimumPriceText = (event.currentTarget as HTMLInputElement).value;
  }

  function handleMaximumPriceInput(event: Event): void {
    maximumPriceText = (event.currentTarget as HTMLInputElement).value;
  }

  function toggleSize(size: Size): void {
    selectedSizes = selectedSizes.includes(size)
      ? selectedSizes.filter((selectedSize) => selectedSize !== size)
      : [...selectedSizes, size];
  }

  function toggleColor(color: Color): void {
    selectedColors = selectedColors.includes(color)
      ? selectedColors.filter((selectedColor) => selectedColor !== color)
      : [...selectedColors, color];
  }

  function clearFilters(): void {
    minimumPriceText = "";
    maximumPriceText = "";
    selectedSizes = [];
    selectedColors = [];
  }

  async function searchKeyword(): Promise<void> {
    const currentSearchSeq = ++searchSeq;
    const query = keywordText.trim();
    searchMode = "keyword";
    results = [];
    selectedFileName = "";

    if (query === "") {
      loadingSearch = false;
      errorMessage = "";
      return;
    }

    loadingSearch = true;
    errorMessage = "";

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: query }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "検索に失敗しました。"));
      }
      if (!isSearchResponse(payload)) {
        throw new Error("検索結果の形式が正しくありません。");
      }
      if (currentSearchSeq === searchSeq) {
        results = payload.results;
      }
    } catch (error) {
      if (currentSearchSeq === searchSeq) {
        errorMessage = error instanceof Error ? error.message : "検索に失敗しました。";
        results = [];
      }
    } finally {
      if (currentSearchSeq === searchSeq) {
        loadingSearch = false;
      }
    }
  }

  async function search(file: File): Promise<void> {
    const currentSearchSeq = ++searchSeq;

    if (!isSupportedImage(file)) {
      if (currentSearchSeq === searchSeq) {
        errorMessage = "PNGまたはJPEG画像を選択してください。";
      }
      return;
    }

    loadingSearch = true;
    errorMessage = "";
    keywordText = "";
    searchMode = "image";
    results = [];
    selectedFileName = file.name;

    const formData = new FormData();
    formData.append("image", file);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        body: formData,
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "検索に失敗しました。"));
      }
      if (!isSearchResponse(payload)) {
        throw new Error("検索結果の形式が正しくありません。");
      }
      if (currentSearchSeq === searchSeq) {
        results = payload.results;
      }
    } catch (error) {
      if (currentSearchSeq === searchSeq) {
        errorMessage = error instanceof Error ? error.message : "検索に失敗しました。";
        results = [];
      }
    } finally {
      if (currentSearchSeq === searchSeq) {
        loadingSearch = false;
      }
    }
  }

  function chooseFile(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      void search(file);
    }
    input.value = "";
  }

  function handleDragOver(event: DragEvent): void {
    event.preventDefault();
    dragging = true;
  }

  function handleDragLeave(event: DragEvent): void {
    event.preventDefault();
    dragging = false;
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    dragging = false;
    const file = event.dataTransfer?.files[0];
    if (file) {
      void search(file);
    }
  }

  async function searchProduct(product: Product): Promise<void> {
    const currentSearchSeq = ++searchSeq;
    keywordText = "";
    searchMode = "image";
    results = [];
    loadingSearch = false;

    try {
      const response = await fetch(product.image);
      if (!response.ok) {
        throw new Error("商品画像を読み込めませんでした。");
      }
      const blob = await response.blob();
      const file = new File([blob], `${product.id}.png`, {
        type: blob.type === "image/jpeg" ? "image/jpeg" : "image/png",
      });

      if (currentSearchSeq !== searchSeq) {
        return;
      }
      await search(file);
    } catch (error) {
      if (currentSearchSeq === searchSeq) {
        errorMessage = error instanceof Error ? error.message : "商品画像を読み込めませんでした。";
      }
    }
  }

  $effect(() => {
    void loadProducts();
  });
</script>

<svelte:head>
  <title>商品画像の類似検索</title>
</svelte:head>

<main class="page-shell">
  <section class="hero">
    <p class="eyebrow">IMAGE SEARCH DEMO</p>
    <h1>画像から、似ている商品を探す</h1>
    <p class="intro">商品画像をアップロードするか、商品名や特徴を入力すると似ている商品を検索できます。</p>
  </section>

  <section class="search-panel" aria-labelledby="search-title">
    <div class="section-heading">
      <div>
        <p class="eyebrow">01 / SEARCH</p>
        <h2 id="search-title">検索画像を選択</h2>
      </div>
      {#if selectedFileName}
        <span class="file-name">{selectedFileName}</span>
      {/if}
    </div>

    <label
      class:dragging
      class="drop-zone"
      for="image-input"
      ondragover={handleDragOver}
      ondragleave={handleDragLeave}
      ondrop={handleDrop}
    >
      <span class="drop-icon" aria-hidden="true">↥</span>
      <span class="drop-title">画像をドロップ</span>
      <span class="drop-hint">またはクリックしてPNG / JPEGを選択</span>
      <input id="image-input" type="file" accept="image/png,image/jpeg" onchange={chooseFile} />
    </label>

    <div class="keyword-search">
      <input
        class="keyword-filter"
        type="search"
        placeholder="商品名や特徴でセマンティック検索"
        value={keywordText}
        oninput={handleKeywordInput}
        onkeydown={handleKeywordKeydown}
      />
      <button
        class="keyword-search-button"
        type="button"
        disabled={loadingSearch || keywordQuery === ""}
        onclick={() => void searchKeyword()}
      >
        検索
      </button>
    </div>

    <div class="filter-controls" aria-label="商品情報で絞り込む">
      <div class="filter-row">
        <fieldset class="filter-group price-filter">
          <legend>価格帯</legend>
          <div class="price-inputs">
            <input
              class="price-input"
              type="number"
              min="0"
              inputmode="numeric"
              placeholder="下限"
              aria-label="価格の下限"
              value={minimumPriceText}
              oninput={handleMinimumPriceInput}
            />
            <span aria-hidden="true">〜</span>
            <input
              class="price-input"
              type="number"
              min="0"
              inputmode="numeric"
              placeholder="上限"
              aria-label="価格の上限"
              value={maximumPriceText}
              oninput={handleMaximumPriceInput}
            />
          </div>
        </fieldset>

        <fieldset class="filter-group size-filter">
          <legend>サイズ展開</legend>
          <div class="size-options">
            {#each availableSizes as size}
              <label class="size-option">
                <input
                  type="checkbox"
                  checked={selectedSizes.includes(size)}
                  onchange={() => toggleSize(size)}
                />
                <span>{size}</span>
              </label>
            {/each}
          </div>
        </fieldset>
      </div>

      <div class="filter-row color-filter-row">
        <fieldset class="filter-group color-filter">
          <legend>色</legend>
          <div class="color-options">
            {#each availableColors as color}
              <button
                class:active={selectedColors.includes(color)}
                class="color-chip"
                type="button"
                aria-pressed={selectedColors.includes(color)}
                onclick={() => toggleColor(color)}
              >
                <span
                  class="color-swatch"
                  style={`--swatch-color: ${colorSwatches[color]}`}
                  aria-hidden="true"
                ></span>
                <span>{colorLabels[color]}</span>
              </button>
            {/each}
          </div>
        </fieldset>
        <button
          class="clear-filters"
          type="button"
          disabled={!hasMetadataFilters}
          onclick={clearFilters}
        >
          条件をクリア
        </button>
      </div>
    </div>

    {#if loadingSearch}
      <p class="status" aria-live="polite">検索中…</p>
    {/if}
    {#if errorMessage}
      <p class="error" role="alert">{errorMessage}</p>
    {/if}
  </section>

  <section class="results-section" aria-labelledby="results-title">
    <div class="section-heading">
      <div>
        <p class="eyebrow">02 / RESULTS</p>
        <h2 id="results-title">類似商品</h2>
      </div>
      {#if displayedResults.length > 0}
        <span class="result-count">{displayedResults.length} items</span>
      {/if}
    </div>

    {#if displayedResults.length > 0}
      <div class="result-grid">
        {#each displayedResults as result (result.id)}
          {@const product = productsById.get(result.id)}
          {@const price = result.price ?? product?.price}
          {@const sizes = result.sizes ?? product?.sizes}
          {@const color = result.color ?? product?.color}
          <article class="result-card">
            <img
              src={result.image}
              alt={product?.name ?? result.name}
              title={product ? getImageTitle(product) : result.name}
            />
            <div class="card-details">
              <div>
                <h3>{product?.name ?? result.name}</h3>
                <p>{product?.category ?? result.category}</p>
              </div>
              {#if result.score !== undefined}
                <span class="score">{result.score.toFixed(3)}</span>
              {/if}
            </div>
            {#if result.description}
              <p class="result-description">{result.description}</p>
            {/if}
            {#if price !== undefined || sizes !== undefined || color !== undefined}
              <div class="product-metadata">
                {#if price !== undefined}
                  <span class="product-price">¥{price.toLocaleString("ja-JP")}</span>
                {/if}
                {#if sizes !== undefined}
                  <span>{sizes.join(" / ")}</span>
                {/if}
                {#if color !== undefined}
                  <span
                    class="metadata-color"
                    style={`--swatch-color: ${getColorSwatch(color)}`}
                    title={getColorLabel(color)}
                    aria-label={`色: ${getColorLabel(color)}`}
                  ></span>
                {/if}
              </div>
            {/if}
          </article>
        {/each}
      </div>
    {:else if !loadingSearch}
      <p class="empty-state">検索結果はここに表示されます。</p>
    {/if}
  </section>

  <section class="catalog-section" aria-labelledby="catalog-title">
    <div class="section-heading">
      <div>
        <p class="eyebrow">03 / CATALOG</p>
        <h2 id="catalog-title">登録済み商品</h2>
      </div>
      {#if !loadingProducts}
        <span class="result-count">{products.length} items</span>
      {/if}
    </div>

    {#if loadingProducts}
      <p class="status">商品一覧を読み込み中…</p>
    {:else}
      <div class="catalog-grid">
        {#each products as product (product.id)}
          <button class="product-card" type="button" onclick={() => void searchProduct(product)}>
            <img
              src={product.image}
              alt={product.name}
              title={getImageTitle(product)}
              loading="lazy"
            />
            <span class="product-name">{product.name}</span>
            <span class="product-category">{product.category}</span>
            <span class="product-metadata">
              <span class="product-price">¥{product.price.toLocaleString("ja-JP")}</span>
              <span>{product.sizes.join(" / ")}</span>
              <span
                class="metadata-color"
                style={`--swatch-color: ${getColorSwatch(product.color)}`}
                title={getColorLabel(product.color)}
                aria-label={`色: ${getColorLabel(product.color)}`}
              ></span>
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <footer class="attribution">Images: 自動生成（パラメトリック 3D レンダ / CC0-1.0。寸法は画像の title 属性を参照）</footer>
</main>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    min-width: 320px;
    color: #28231f;
    background: #f4f0e9;
    font-family: "Avenir Next", Avenir, "Hiragino Kaku Gothic ProN", sans-serif;
  }

  :global(button),
  :global(input) {
    font: inherit;
  }

  .page-shell {
    width: min(1180px, calc(100% - 40px));
    margin: 0 auto;
    padding: 72px 0 96px;
  }

  .hero {
    max-width: 720px;
    margin-bottom: 54px;
  }

  .eyebrow {
    margin: 0 0 12px;
    color: #b45137;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.18em;
  }

  h1,
  h2,
  h3,
  p {
    margin-top: 0;
  }

  h1 {
    max-width: 650px;
    margin-bottom: 18px;
    font-size: clamp(2.4rem, 7vw, 5.4rem);
    line-height: 0.98;
    letter-spacing: -0.07em;
  }

  .intro {
    margin-bottom: 0;
    color: #716960;
    font-size: 1rem;
    line-height: 1.8;
  }

  .search-panel,
  .results-section,
  .catalog-section {
    margin-top: 32px;
    padding: 30px;
    border: 1px solid #ded7cd;
    border-radius: 24px;
    background: rgba(255, 253, 248, 0.72);
  }

  .section-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 24px;
  }

  h2 {
    margin-bottom: 0;
    font-size: clamp(1.45rem, 3vw, 2rem);
    letter-spacing: -0.04em;
  }

  .file-name,
  .result-count {
    color: #8a8178;
    font-size: 0.78rem;
  }

  .drop-zone {
    display: flex;
    min-height: 220px;
    cursor: pointer;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 9px;
    border: 1.5px dashed #c9a08e;
    border-radius: 18px;
    background: #fffaf2;
    color: #50483f;
    text-align: center;
    transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
  }

  .drop-zone:hover,
  .drop-zone.dragging {
    border-color: #b45137;
    background: #fff3e6;
    transform: translateY(-2px);
  }

  .drop-zone input {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .drop-icon {
    display: grid;
    width: 46px;
    height: 46px;
    place-items: center;
    border-radius: 50%;
    background: #e9c5b0;
    color: #713d2c;
    font-size: 1.8rem;
  }

  .drop-title {
    font-size: 1.1rem;
    font-weight: 700;
  }

  .drop-hint {
    color: #8a8178;
    font-size: 0.8rem;
  }

  .status,
  .error,
  .empty-state {
    margin: 18px 0 0;
    color: #8a8178;
    font-size: 0.88rem;
  }

  .error {
    color: #a43f32;
  }

  .result-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 16px;
  }

  .result-card {
    overflow: hidden;
    border: 1px solid #e5ded4;
    border-radius: 16px;
    background: #fffdf8;
  }

  .result-card img {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
  }

  .card-details {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 14px;
  }

  .card-details h3 {
    margin-bottom: 4px;
    font-size: 0.92rem;
  }

  .card-details p,
  .product-category {
    margin-bottom: 0;
    color: #8a8178;
    font-size: 0.75rem;
  }

  .result-description {
    display: -webkit-box;
    margin: 0;
    overflow: hidden;
    padding: 0 14px 12px;
    color: #50483f;
    font-size: 0.76rem;
    line-height: 1.55;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  .product-metadata {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
    padding: 0 14px 14px;
    color: #716960;
    font-size: 0.72rem;
  }

  .product-price {
    color: #8b432d;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .metadata-color,
  .color-swatch {
    display: inline-block;
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
    border: 1px solid rgba(40, 35, 31, 0.2);
    border-radius: 50%;
    background: var(--swatch-color);
  }

  .score {
    flex: 0 0 auto;
    padding: 4px 6px;
    border-radius: 6px;
    background: #f0e1d5;
    color: #8b432d;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }

  .catalog-section {
    margin-top: 72px;
  }

  .keyword-search {
    display: flex;
    gap: 8px;
    margin-top: 24px;
  }

  .keyword-filter {
    display: block;
    flex: 1 1 auto;
    width: 100%;
    padding: 12px 14px;
    border: 1px solid #ded7cd;
    border-radius: 12px;
    background: #fffaf2;
    color: inherit;
  }

  .keyword-filter:focus {
    border-color: #b45137;
    outline: 2px solid #e9c5b0;
    outline-offset: 2px;
  }

  .keyword-search-button {
    flex: 0 0 auto;
    padding: 0 18px;
    border: 1px solid #b45137;
    border-radius: 12px;
    background: #b45137;
    color: #fffaf2;
    cursor: pointer;
    font-size: 0.82rem;
    font-weight: 700;
  }

  .keyword-search-button:hover,
  .keyword-search-button:focus-visible {
    background: #8b432d;
    outline: 2px solid #e9c5b0;
    outline-offset: 2px;
  }

  .keyword-search-button:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .filter-controls {
    display: grid;
    gap: 14px;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid #e5ded4;
  }

  .filter-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 14px 22px;
  }

  .filter-group {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .filter-group legend {
    padding: 0;
    color: #716960;
    font-size: 0.74rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .price-inputs,
  .size-options,
  .color-options {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .price-input {
    width: 92px;
    padding: 8px 9px;
    border: 1px solid #ded7cd;
    border-radius: 9px;
    background: #fffaf2;
    color: inherit;
    font-size: 0.78rem;
  }

  .price-input:focus {
    border-color: #b45137;
    outline: 2px solid #e9c5b0;
    outline-offset: 1px;
  }

  .size-option {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: #50483f;
    font-size: 0.8rem;
  }

  .size-option input {
    accent-color: #b45137;
  }

  .color-filter {
    flex: 1 1 auto;
  }

  .color-options {
    flex-wrap: wrap;
  }

  .color-chip,
  .clear-filters {
    border: 1px solid #ded7cd;
    border-radius: 999px;
    background: #fffaf2;
    color: #50483f;
    cursor: pointer;
    font-size: 0.74rem;
  }

  .color-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 9px;
  }

  .color-chip.active {
    border-color: #b45137;
    background: #f0e1d5;
    color: #713d2c;
  }

  .color-chip:hover,
  .color-chip:focus-visible,
  .clear-filters:hover,
  .clear-filters:focus-visible {
    border-color: #b45137;
    outline: none;
  }

  .clear-filters {
    margin-left: auto;
    padding: 7px 12px;
  }

  .clear-filters:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .catalog-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 12px;
  }

  .product-card {
    padding: 0;
    overflow: hidden;
    cursor: pointer;
    border: 1px solid transparent;
    border-radius: 14px;
    background: #fffdf8;
    color: inherit;
    text-align: left;
    transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
  }

  .product-card:hover,
  .product-card:focus-visible {
    border-color: #c98268;
    box-shadow: 0 10px 24px rgba(87, 57, 40, 0.12);
    outline: none;
    transform: translateY(-3px);
  }

  .product-card img {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
  }

  .product-name,
  .product-category {
    display: block;
    padding: 0 10px;
  }

  .product-card .product-metadata {
    gap: 4px 8px;
    padding: 0 10px 12px;
    font-size: 0.68rem;
  }

  .product-name {
    margin-top: 10px;
    font-size: 0.78rem;
    font-weight: 700;
  }

  .product-category {
    padding-top: 4px;
    padding-bottom: 12px;
    text-transform: uppercase;
  }

  .attribution {
    margin-top: 28px;
    color: #8a8178;
    font-size: 0.75rem;
    text-align: center;
  }

  @media (max-width: 900px) {
    .result-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .catalog-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  @media (max-width: 620px) {
    .page-shell {
      width: min(100% - 24px, 540px);
      padding-top: 42px;
    }

    .search-panel,
    .results-section,
    .catalog-section {
      padding: 20px;
      border-radius: 18px;
    }

    .section-heading {
      align-items: flex-start;
      flex-direction: column;
      gap: 8px;
    }

    .filter-group {
      align-items: flex-start;
      flex-direction: column;
      gap: 7px;
    }

    .clear-filters {
      margin-left: 0;
    }

    .result-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .catalog-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
