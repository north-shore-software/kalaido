import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

const site = "https://docs.kalaido.co";

export default defineConfig({
  site,
  integrations: [
    starlight({
      title: "Kalaido",
      logo: {
        light: "@kalaido/brand/kalaido-wordmark-signature-light.svg",
        dark: "@kalaido/brand/kalaido-wordmark-signature-dark.svg",
        alt: "Kalaido",
        replacesTitle: true,
      },
      favicon: "/brand/favicon.svg",
      head: [
        {
          tag: "link",
          attrs: {
            rel: "icon",
            href: "/brand/favicon-32.png",
            sizes: "32x32",
            type: "image/png",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "apple-touch-icon",
            href: "/brand/apple-touch-icon.png",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "mask-icon",
            href: "/brand/mask-icon.svg",
            color: "#1A1B1E",
          },
        },
        { tag: "meta", attrs: { name: "theme-color", content: "#1A1B1E" } },
        {
          tag: "meta",
          attrs: {
            property: "og:image",
            content: `${site}/brand/kalaido-og-1200x630.png`,
          },
        },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        {
          tag: "meta",
          attrs: {
            property: "og:image:alt",
            content: "Kalaido — From chaos, create.",
          },
        },
      ],
      customCss: [
        "@fontsource-variable/archivo/wght.css",
        "@fontsource-variable/jetbrains-mono/wght.css",
        "@fontsource-variable/source-serif-4/opsz.css",
        "./src/styles/kalaido.css",
      ],
      expressiveCode: {
        styleOverrides: { borderRadius: "0" },
      },
      components: {
        Footer: "./src/components/Footer.astro",
      },
      sidebar: [
        {
          label: "Start here",
          items: [{ autogenerate: { directory: "start-here" } }],
        },
        {
          label: "Concepts",
          items: [{ autogenerate: { directory: "concepts" } }],
        },
        { label: "Guides", items: [{ autogenerate: { directory: "guides" } }] },
        {
          label: "Reference",
          items: [{ autogenerate: { directory: "reference" } }],
        },
      ],
    }),
  ],
});
