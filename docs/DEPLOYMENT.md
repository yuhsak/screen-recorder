# Deployment

[English README](../README.md) · [日本語README](../README.ja.md)

The site is configured for [screen-recorder.ysk.im](https://screen-recorder.ysk.im/), served at the domain root with Vite’s `base` set to `/`. Production uses static files only; no Node.js server is required.

## GitHub Pages setup

1. In the repository’s **Settings → Pages**, set **Source** to **GitHub Actions**.
2. Set **Custom domain** to `screen-recorder.ysk.im` and save it before configuring DNS.
3. At your DNS provider, create a CNAME record named `screen-recorder` under `ysk.im`, pointing to `<user-or-organization>.github.io`. Do not include the repository name.
4. Enable **Enforce HTTPS** once the certificate is ready.
5. Push to `main` to run the deployment workflow, or select **Actions → Check and deploy → Run workflow** on `main`.

The custom domain is configured in GitHub’s settings. A repository `CNAME` file is not needed for this Actions workflow. See [GitHub’s custom domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

## Build and deployment

[The workflow](../.github/workflows/pages.yml) uses Node.js 24, runs `npm ci`, `npm run check`, and `npm run build`, then deploys `dist/` from `main`. Pull requests run the checks and build without deploying.

The build emits three pages that can be opened directly:

| URL    | Language                                                                         |
| ------ | -------------------------------------------------------------------------------- |
| `/`    | Saved preference, then the browser’s preferred language, falling back to English |
| `/en/` | English                                                                          |
| `/ja/` | Japanese                                                                         |

Each page includes its own canonical URL and reciprocal `hreflang` links. `/` is the `x-default` entry point, with English initial HTML and sharing metadata. The language-specific pages include localized content and metadata. All three use the same English OGP image.

## Metadata and domain changes

- The public site URL is defined in [`src/i18n/routes.ts`](../src/i18n/routes.ts).
- Translated copy lives in [`src/i18n/en.ts`](../src/i18n/en.ts) and [`src/i18n/ja.ts`](../src/i18n/ja.ts); metadata is assembled in [`src/i18n/metadata.ts`](../src/i18n/metadata.ts).
- [`public/robots.txt`](../public/robots.txt) and [`public/sitemap.xml`](../public/sitemap.xml) contain absolute URLs. Update them when changing the domain, along with the links in the READMEs.
- The OGP image is [`public/og-image.png`](../public/og-image.png), with its editable source in [`docs/og-image.svg`](og-image.svg). Update both if changing the domain printed on the image.

After publishing, you can register the site in Google Search Console and submit [sitemap.xml](https://screen-recorder.ysk.im/sitemap.xml).
