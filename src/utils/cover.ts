import type { CollectionEntry } from "astro:content";
import { postConfig } from "@/config";

// Build 时随机种子，每次构建都不同
const buildSeed = Math.floor(Math.random() * 999999);

// 同一构建内按文章 id 缓存，确保列表页和详情页拿到同一张图
const coverCache = new Map<string, string>();

/**
 * 获取文章封面图
 *
 * 当文章 frontmatter 没有 cover 且 randomCover 功能启用时，
 * 从配置的图片池中按 buildSeed + 文章 id 确定性地分配一张，
 * 确保同一构建内同篇文章始终拿到同一张图。
 */
export function getRandomCover(entry: CollectionEntry<"posts">): string {
    const config = postConfig.randomCover;
    if (!config?.enable || !config.images?.length) {
        return entry.data.cover || "";
    }

    // 文章已有封面且不强制覆盖，则直接返回
    if (entry.data.cover && !config.override) {
        return entry.data.cover;
    }

    // 查缓存
    const cached = coverCache.get(entry.id);
    if (cached) return cached;

    // 按 buildSeed + entry.id 哈希取模，保证同构建内同文章同图
    let hash = buildSeed;
    for (let i = 0; i < entry.id.length; i++) {
        hash = ((hash << 5) - hash + entry.id.charCodeAt(i)) | 0;
    }
    hash = Math.abs(hash);

    const coverUrl = config.images[hash % config.images.length] || config.images[0];
    coverCache.set(entry.id, coverUrl);
    return coverUrl;
}
