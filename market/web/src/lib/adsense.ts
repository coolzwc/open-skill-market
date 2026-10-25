/**
 * Google AdSense 配置。
 * ADSENSE_CLIENT 需与 public/ads.txt 中的 pub 号保持一致。
 * AD_SLOTS 中的 slot id 需在 AdSense 后台「广告单元」中创建后替换为真实值。
 */
export const ADSENSE_CLIENT = "ca-pub-7474991017151800";

export const AD_SLOTS = {
  /** 列表页：分类栏与技能卡片列表之间的横幅广告 */
  marketBanner: "1234567890",
  /** 详情页：右侧栏的矩形广告 */
  detailAside: "0987654321",
  /** 详情页：正文底部的横幅广告 */
  detailBanner: "2345678901"
} as const;
