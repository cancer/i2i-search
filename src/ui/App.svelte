<script module lang="ts">
  let searchSeq = 0;
</script>

<script lang="ts">
  type Product = {
    id: string;
    name: string;
    category: string;
    image: string;
    credit: {
      title: string;
      author: string;
      license: string;
      source: string;
    };
  };

  type SearchResult = Omit<Product, "credit"> & {
    score: number;
  };

  let products = $state<Product[]>([]);
  let productsById = $derived(new Map(products.map((product) => [product.id, product])));
  let filterText = $state("");
  let filteredProducts = $derived(
    products.filter((product) => {
      const query = filterText.trim().toLowerCase();
      return query === ""
        || product.name.toLowerCase().includes(query)
        || product.category.toLowerCase().includes(query)
        || product.credit.title.toLowerCase().includes(query);
    }),
  );
  let results = $state<SearchResult[]>([]);
  let loadingProducts = $state(true);
  let loadingSearch = $state(false);
  let dragging = $state(false);
  let errorMessage = $state("");
  let selectedFileName = $state("");

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  function isCredit(value: unknown): value is Product["credit"] {
    return isRecord(value)
      && typeof value.title === "string"
      && typeof value.author === "string"
      && typeof value.license === "string"
      && typeof value.source === "string";
  }

  function isProduct(value: unknown): value is Product {
    return isRecord(value)
      && typeof value.id === "string"
      && typeof value.name === "string"
      && typeof value.category === "string"
      && typeof value.image === "string"
      && isCredit(value.credit);
  }

  function isSearchResult(value: unknown): value is SearchResult {
    return isRecord(value)
      && typeof value.id === "string"
      && typeof value.name === "string"
      && typeof value.category === "string"
      && typeof value.image === "string"
      && typeof value.score === "number"
      && Number.isFinite(value.score);
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
    return `${product.name} — ${product.credit.author} / ${product.credit.license} (Wikimedia Commons)`;
  }

  async function loadProducts(): Promise<void> {
    loadingProducts = true;
    try {
      const response = await fetch("/products.json");
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
    try {
      const response = await fetch(product.image);
      if (!response.ok) {
        throw new Error("商品画像を読み込めませんでした。");
      }
      const blob = await response.blob();
      const file = new File([blob], `${product.id}.png`, {
        type: blob.type === "image/jpeg" ? "image/jpeg" : "image/png",
      });
      await search(file);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "商品画像を読み込めませんでした。";
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
    <p class="intro">商品画像をアップロードするか、下の商品を選ぶと類似画像を検索できます。</p>
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
      {#if results.length > 0}
        <span class="result-count">{results.length} items</span>
      {/if}
    </div>

    {#if results.length > 0}
      <div class="result-grid">
        {#each results as result (result.id)}
          {@const product = productsById.get(result.id)}
          <article class="result-card">
            <img
              src={result.image}
              alt={result.name}
              title={product ? getImageTitle(product) : result.name}
            />
            <div class="card-details">
              <div>
                <h3>{result.name}</h3>
                <p>{result.category}</p>
              </div>
              <span class="score">{result.score.toFixed(3)}</span>
            </div>
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
        <span class="result-count">
          {filterText.trim() ? `${filteredProducts.length} / ${products.length} items` : `${filteredProducts.length} items`}
        </span>
      {/if}
    </div>

    <input
      class="catalog-filter"
      type="search"
      placeholder="商品名・カテゴリで絞り込み"
      bind:value={filterText}
    />

    {#if loadingProducts}
      <p class="status">商品一覧を読み込み中…</p>
    {:else if filteredProducts.length === 0}
      <p class="empty-state">該当する商品がありません</p>
    {:else}
      <div class="catalog-grid">
        {#each filteredProducts as product (product.id)}
          <button class="product-card" type="button" onclick={() => void searchProduct(product)}>
            <img
              src={product.image}
              alt={product.name}
              title={getImageTitle(product)}
              loading="lazy"
            />
            <span class="product-name">{product.name}</span>
            <span class="product-category">{product.category}</span>
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <footer class="attribution">Photos: Wikimedia Commons（各画像の帰属は画像の title 属性を参照）</footer>
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

  .catalog-filter {
    display: block;
    width: 100%;
    margin-bottom: 24px;
    padding: 12px 14px;
    border: 1px solid #ded7cd;
    border-radius: 12px;
    background: #fffaf2;
    color: inherit;
  }

  .catalog-filter:focus {
    border-color: #b45137;
    outline: 2px solid #e9c5b0;
    outline-offset: 2px;
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

    .result-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .catalog-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
