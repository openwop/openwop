/**
 * vendor.myndhyve.ads-platforms — ads.platform.specs executor.
 *
 * Lifts MyndHyve's PlatformSpecRegistry + the 9 per-platform spec
 * data files (amazon, google, linkedin, meta, pinterest, reddit,
 * snapchat, tiktok, x) into one self-contained pack. ~1500 LOC of
 * platform data inlined verbatim from src/canvas-types/campaign-
 * studio/ads-studio/platforms/specs/.
 *
 * Pure data + lookup. No host capabilities, no AI, no external calls.
 *
 * Only `getSpecSet(platforms, placements?)` is invoked by the
 * executor — the helper namespace (getSpecForPlacement, validateText,
 * getSafeZones, getMostRestrictiveLimits, getCharacterCountState,
 * getCaptionGuidance, getAudioGuidance) are NOT exposed since they
 * have no caller in the wrapping `ads.platform.specs` node. Future
 * pack PRs that need them can either bundle their own copy of the
 * data OR depend on this pack via `dependencies` once openwop adds
 * inter-pack import support.
 */

function makeLog(ctx) {
  const fn = typeof ctx?.log === 'function' ? ctx.log : null;
  return {
    info: (msg, data) => { if (fn) fn('info', msg, data); },
    debug: (msg, data) => { if (fn) fn('debug', msg, data); },
    warn: (msg, data) => { if (fn) fn('warn', msg, data); },
    error: (msg, data) => { if (fn) fn('error', msg, data); },
  };
}

// ─── AMAZON ──────────────────────────────────────
const AMAZON_PLATFORM_INFO = {
  id: 'amazon',
  name: 'Amazon DSP',
  iconName: 'amazon',
  color: { light: '#FF9900', dark: '#FFB84D' },
  placements: [
    'amazon-display',
    'amazon-video',
    'amazon-audio',
  ],
};

const AMAZON_CTA_PRESETS = [
  'Shop Now', 'Learn More', 'Add to Cart', 'Buy Now', 'See Details',
  'Subscribe & Save', 'Pre-order Now', 'Watch Now', 'Listen Now',
];

const AMAZON_SPECS = [
  {
    platform: 'amazon',
    placement: 'amazon-display',
    displayName: 'Display Ad',
    supportedTypes: ['image'],
    textLimits: {
      headline: { min: 1, max: 50, recommended: 30 },
      description: { min: 1, max: 90, recommended: 60 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 728, height: 90, label: 'Leaderboard (728x90)' },
        { width: 300, height: 250, label: 'Medium Rectangle (300x250)' },
        { width: 160, height: 600, label: 'Wide Skyscraper (160x600)' },
        { width: 300, height: 600, label: 'Half Page (300x600)' },
        { width: 970, height: 250, label: 'Billboard (970x250)' },
        { width: 320, height: 50, label: 'Mobile Banner (320x50)' },
        { width: 414, height: 125, label: 'Mobile Billboard (414x125)' },
        { width: 1242, height: 375, label: 'Fire TV (1242x375)' },
      ],
      minWidth: 320,
      minHeight: 50,
      recommendedWidth: 728,
      recommendedHeight: 90,
      maxFileSize: 200 * 1024, // 200KB for display
      formats: ['jpg', 'png', 'gif'],
    },
    ctaOptions: {
      customAllowed: false,
      presets: AMAZON_CTA_PRESETS,
    },
  },
  {
    platform: 'amazon',
    placement: 'amazon-video',
    displayName: 'Online Video (OLV)',
    supportedTypes: ['video'],
    textLimits: {
      headline: { min: 1, max: 90 },
      description: { min: 1, max: 150 },
    },
    videoSpec: {
      aspectRatios: [
        { width: 16, height: 9, label: '16:9 Standard' },
        { width: 1, height: 1, label: '1:1 Square' },
        { width: 9, height: 16, label: '9:16 Vertical' },
      ],
      minDuration: 6,
      maxDuration: 120,
      recommendedDuration: 30,
      minWidth: 1280,
      minHeight: 720,
      recommendedWidth: 1920,
      recommendedHeight: 1080,
      maxFileSize: 500 * 1024 * 1024,
      formats: ['mp4', 'mov', 'webm'],
      codecs: ['h264', 'hevc'],
      minFps: 24,
      maxFps: 60,
    },
    ctaOptions: {
      customAllowed: true,
      presets: AMAZON_CTA_PRESETS,
    },
    safeZones: [
      { label: 'Skip Button', top: 85, left: 75, width: 25, height: 15 },
    ],
  },
  {
    platform: 'amazon',
    placement: 'amazon-audio',
    displayName: 'Audio Ad',
    supportedTypes: ['image'], // Companion banner
    textLimits: {
      headline: { min: 1, max: 50 },
      description: { min: 1, max: 90 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 1, height: 1, label: '1:1 Companion Square' },
        { width: 300, height: 250, label: 'Companion Rectangle' },
      ],
      minWidth: 300,
      minHeight: 250,
      recommendedWidth: 640,
      recommendedHeight: 640,
      maxFileSize: 200 * 1024,
      formats: ['jpg', 'png'],
    },
    ctaOptions: {
      customAllowed: false,
      presets: AMAZON_CTA_PRESETS,
    },
  },
];

/**
 * Amazon-specific display ad sizes with detailed specs
 */
const AMAZON_DISPLAY_SIZES = {
  leaderboard: { width: 728, height: 90, name: 'Leaderboard' },
  mediumRectangle: { width: 300, height: 250, name: 'Medium Rectangle' },
  wideSkyscraper: { width: 160, height: 600, name: 'Wide Skyscraper' },
  halfPage: { width: 300, height: 600, name: 'Half Page' },
  billboard: { width: 970, height: 250, name: 'Billboard' },
  mobileBanner: { width: 320, height: 50, name: 'Mobile Banner' },
  mobileBillboard: { width: 414, height: 125, name: 'Mobile Billboard' },
  fireTV: { width: 1242, height: 375, name: 'Fire TV' },
};

// ─── GOOGLE ──────────────────────────────────────
const GOOGLE_PLATFORM_INFO = {
  id: 'google',
  name: 'Google Ads',
  iconName: 'google',
  color: { light: '#4285F4', dark: '#8AB4F8' },
  placements: [
    'google-search',
    'google-display',
    'google-youtube-instream',
    'google-youtube-shorts',
    'google-youtube-bumper',
    'google-youtube-nonskippable',
    'google-youtube-infeed',
    'google-discovery',
  ],
};

const GOOGLE_SPECS = [
  {
    platform: 'google',
    placement: 'google-search',
    displayName: 'Google Search (RSA)',
    supportedTypes: [],
    textLimits: {
      headline: { min: 1, max: 30, recommended: 30 },
      description: { min: 1, max: 90, recommended: 80 },
      displayUrl: { max: 15 },
    },
    ctaOptions: {
      customAllowed: false,
      presets: [],
    },
  },
  {
    platform: 'google',
    placement: 'google-display',
    displayName: 'Google Display Network',
    supportedTypes: ['image', 'video'],
    textLimits: {
      headline: { min: 1, max: 30 },
      description: { min: 1, max: 90 },
      bodyText: { min: 1, max: 90, recommended: 60 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 1, height: 1, label: '1:1 Square' },
        { width: 1.91, height: 1, label: '1.91:1 Landscape' },
      ],
      minWidth: 600,
      minHeight: 314,
      recommendedWidth: 1200,
      recommendedHeight: 628,
      maxFileSize: 5 * 1024 * 1024,
      formats: ['jpg', 'png', 'gif'],
    },
    ctaOptions: {
      customAllowed: false,
      presets: [
        'Apply Now', 'Book Now', 'Contact Us', 'Download', 'Learn More',
        'Install', 'Visit Site', 'Shop Now', 'Sign Up', 'Subscribe',
      ],
    },
  },
  {
    platform: 'google',
    placement: 'google-youtube-instream',
    displayName: 'YouTube In-Stream',
    supportedTypes: ['video'],
    textLimits: {
      headline: { min: 1, max: 15 },
      description: { min: 1, max: 90 },
      displayUrl: { max: 15 },
    },
    videoSpec: {
      aspectRatios: [{ width: 16, height: 9, label: '16:9 Landscape' }],
      minDuration: 12,
      maxDuration: 180,
      recommendedDuration: 30,
      minWidth: 1920,
      minHeight: 1080,
      recommendedWidth: 1920,
      recommendedHeight: 1080,
      maxFileSize: 256 * 1024 * 1024,
      formats: ['mp4', 'avi', 'wmv', 'mov'],
      minFps: 24,
      maxFps: 60,
    },
    ctaOptions: {
      customAllowed: true,
      presets: ['Visit Site', 'Learn More', 'Shop Now', 'Sign Up'],
    },
  },
  {
    platform: 'google',
    placement: 'google-youtube-shorts',
    displayName: 'YouTube Shorts',
    supportedTypes: ['video'],
    textLimits: {
      headline: { min: 1, max: 30 },
      description: { min: 1, max: 90 },
    },
    videoSpec: {
      aspectRatios: [{ width: 9, height: 16, label: '9:16 Vertical' }],
      minDuration: 6,
      maxDuration: 60,
      recommendedDuration: 20,
      minWidth: 1080,
      minHeight: 1920,
      recommendedWidth: 1080,
      recommendedHeight: 1920,
      maxFileSize: 256 * 1024 * 1024,
      formats: ['mp4', 'mov'],
      minFps: 24,
      maxFps: 60,
    },
    ctaOptions: {
      customAllowed: false,
      presets: ['Visit Site', 'Learn More', 'Shop Now'],
    },
  },
  {
    platform: 'google',
    placement: 'google-youtube-bumper',
    displayName: 'YouTube Bumper Ads',
    supportedTypes: ['video'],
    textLimits: {
      headline: { min: 1, max: 15 },
      description: { min: 1, max: 90 },
    },
    videoSpec: {
      aspectRatios: [{ width: 16, height: 9, label: '16:9 Landscape' }],
      minDuration: 1,
      maxDuration: 6,
      recommendedDuration: 6,
      minWidth: 1920,
      minHeight: 1080,
      recommendedWidth: 1920,
      recommendedHeight: 1080,
      maxFileSize: 256 * 1024 * 1024,
      formats: ['mp4', 'avi', 'wmv', 'mov'],
      minFps: 24,
      maxFps: 60,
    },
    ctaOptions: {
      customAllowed: false,
      presets: ['Visit Site', 'Learn More', 'Shop Now'],
    },
  },
  {
    platform: 'google',
    placement: 'google-youtube-nonskippable',
    displayName: 'YouTube Non-Skippable In-Stream',
    supportedTypes: ['video'],
    textLimits: {
      headline: { min: 1, max: 15 },
      description: { min: 1, max: 90 },
      displayUrl: { max: 15 },
    },
    videoSpec: {
      aspectRatios: [{ width: 16, height: 9, label: '16:9 Landscape' }],
      minDuration: 6,
      maxDuration: 15,
      recommendedDuration: 15,
      minWidth: 1920,
      minHeight: 1080,
      recommendedWidth: 1920,
      recommendedHeight: 1080,
      maxFileSize: 256 * 1024 * 1024,
      formats: ['mp4', 'avi', 'wmv', 'mov'],
      minFps: 24,
      maxFps: 60,
    },
    ctaOptions: {
      customAllowed: true,
      presets: ['Visit Site', 'Learn More', 'Shop Now', 'Sign Up'],
    },
  },
  {
    platform: 'google',
    placement: 'google-youtube-infeed',
    displayName: 'YouTube In-Feed Video',
    supportedTypes: ['video'],
    textLimits: {
      headline: { min: 1, max: 100 },
      description: { min: 1, max: 70 },
    },
    videoSpec: {
      aspectRatios: [
        { width: 16, height: 9, label: '16:9 Landscape' },
        { width: 1, height: 1, label: '1:1 Square' },
      ],
      minDuration: 1,
      maxDuration: 600,
      recommendedDuration: 60,
      minWidth: 1280,
      minHeight: 720,
      recommendedWidth: 1920,
      recommendedHeight: 1080,
      maxFileSize: 256 * 1024 * 1024,
      formats: ['mp4', 'avi', 'wmv', 'mov'],
      minFps: 24,
      maxFps: 60,
    },
    imageSpec: {
      aspectRatios: [{ width: 16, height: 9, label: '16:9 Thumbnail' }],
      minWidth: 1280,
      minHeight: 720,
      recommendedWidth: 1280,
      recommendedHeight: 720,
      maxFileSize: 2 * 1024 * 1024,
      formats: ['jpg', 'png'],
    },
    ctaOptions: {
      customAllowed: false,
      presets: ['Watch Now', 'Learn More', 'Shop Now'],
    },
  },
  {
    platform: 'google',
    placement: 'google-discovery',
    displayName: 'Google Discovery / Demand Gen',
    supportedTypes: ['image', 'video', 'carousel'],
    textLimits: {
      headline: { min: 1, max: 40 },
      description: { min: 1, max: 90 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 1, height: 1, label: '1:1 Square' },
        { width: 1.91, height: 1, label: '1.91:1 Landscape' },
        { width: 4, height: 5, label: '4:5 Portrait' },
      ],
      minWidth: 600,
      minHeight: 314,
      recommendedWidth: 1200,
      recommendedHeight: 628,
      maxFileSize: 5 * 1024 * 1024,
      formats: ['jpg', 'png'],
    },
    ctaOptions: {
      customAllowed: false,
      presets: ['Apply Now', 'Book Now', 'Learn More', 'Shop Now', 'Sign Up'],
    },
  },
];

// ─── LINKEDIN ──────────────────────────────────────
const LINKEDIN_PLATFORM_INFO = {
  id: 'linkedin',
  name: 'LinkedIn Ads',
  iconName: 'linkedin',
  color: { light: '#0A66C2', dark: '#70B5F9' },
  placements: ['linkedin-feed', 'linkedin-message', 'linkedin-text'],
};

const LINKEDIN_SPECS = [
  {
    platform: 'linkedin',
    placement: 'linkedin-feed',
    displayName: 'LinkedIn Feed (Sponsored Content)',
    supportedTypes: ['image', 'video', 'carousel'],
    textLimits: {
      headline: { min: 1, max: 70, recommended: 50 },
      description: { min: 1, max: 100 },
      bodyText: { min: 1, max: 600, recommended: 150 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 1.91, height: 1, label: '1.91:1 Landscape' },
        { width: 1, height: 1, label: '1:1 Square' },
      ],
      minWidth: 400,
      minHeight: 400,
      recommendedWidth: 1200,
      recommendedHeight: 628,
      maxFileSize: 5 * 1024 * 1024,
      formats: ['jpg', 'png', 'gif'],
    },
    videoSpec: {
      aspectRatios: [
        { width: 16, height: 9, label: '16:9 Landscape' },
        { width: 1, height: 1, label: '1:1 Square' },
        { width: 9, height: 16, label: '9:16 Vertical' },
      ],
      minDuration: 3,
      maxDuration: 600,
      recommendedDuration: 30,
      minWidth: 480,
      minHeight: 360,
      recommendedWidth: 1920,
      recommendedHeight: 1080,
      maxFileSize: 200 * 1024 * 1024,
      formats: ['mp4'],
      codecs: ['h264'],
      minFps: 24,
      maxFps: 30,
    },
    ctaOptions: {
      customAllowed: false,
      presets: [
        'Apply', 'Download', 'Learn More', 'Sign Up', 'Subscribe',
        'Register', 'Join', 'Attend', 'Request Demo',
      ],
    },
  },
  {
    platform: 'linkedin',
    placement: 'linkedin-message',
    displayName: 'LinkedIn Message Ads',
    supportedTypes: ['image'],
    textLimits: {
      headline: { min: 1, max: 60, recommended: 40 },
      bodyText: { min: 1, max: 1500, recommended: 500 },
      ctaText: { min: 1, max: 25 },
    },
    imageSpec: {
      aspectRatios: [{ width: 6, height: 5, label: '300x250 Banner' }],
      minWidth: 300,
      minHeight: 250,
      recommendedWidth: 300,
      recommendedHeight: 250,
      maxFileSize: 2 * 1024 * 1024,
      formats: ['jpg', 'png', 'gif'],
    },
    ctaOptions: {
      customAllowed: true,
      presets: ['Learn More', 'Register', 'Sign Up', 'Apply'],
    },
  },
  {
    platform: 'linkedin',
    placement: 'linkedin-text',
    displayName: 'LinkedIn Text Ads',
    supportedTypes: ['image'],
    textLimits: {
      headline: { min: 1, max: 25 },
      description: { min: 1, max: 75 },
    },
    imageSpec: {
      aspectRatios: [{ width: 1, height: 1, label: '1:1 Square' }],
      minWidth: 100,
      minHeight: 100,
      recommendedWidth: 100,
      recommendedHeight: 100,
      maxFileSize: 2 * 1024 * 1024,
      formats: ['jpg', 'png'],
    },
    ctaOptions: {
      customAllowed: false,
      presets: ['Learn More', 'Visit Site', 'Apply', 'Sign Up'],
    },
  },
];

// ─── META ──────────────────────────────────────
const META_PLATFORM_INFO = {
  id: 'meta',
  name: 'Meta (Facebook & Instagram)',
  iconName: 'meta',
  color: { light: '#1877F2', dark: '#4599FF' },
  placements: [
    'meta-feed',
    'meta-stories',
    'meta-reels',
    'meta-right-column',
    'meta-marketplace',
    'meta-messenger',
  ],
};

const META_CTA_PRESETS = [
  'Learn More', 'Shop Now', 'Sign Up', 'Book Now', 'Contact Us',
  'Download', 'Get Offer', 'Get Quote', 'Subscribe', 'Apply Now',
  'Watch More', 'See Menu', 'Order Now',
];

const META_SPECS = [
  {
    platform: 'meta',
    placement: 'meta-feed',
    displayName: 'Facebook/Instagram Feed',
    supportedTypes: ['image', 'video', 'carousel'],
    textLimits: {
      headline: { min: 1, max: 40, recommended: 27 },
      description: { min: 1, max: 125, recommended: 90 },
      bodyText: { min: 1, max: 2200, recommended: 125 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 1, height: 1, label: '1:1 Square' },
        { width: 4, height: 5, label: '4:5 Portrait' },
        { width: 16, height: 9, label: '16:9 Landscape' },
      ],
      minWidth: 600,
      minHeight: 600,
      recommendedWidth: 1080,
      recommendedHeight: 1080,
      maxFileSize: 30 * 1024 * 1024,
      formats: ['jpg', 'png', 'webp'],
      maxTextOverlay: 20,
    },
    videoSpec: {
      aspectRatios: [
        { width: 1, height: 1, label: '1:1 Square' },
        { width: 4, height: 5, label: '4:5 Portrait' },
        { width: 16, height: 9, label: '16:9 Landscape' },
      ],
      minDuration: 1,
      maxDuration: 240,
      recommendedDuration: 15,
      minWidth: 600,
      minHeight: 600,
      recommendedWidth: 1080,
      recommendedHeight: 1080,
      maxFileSize: 4 * 1024 * 1024 * 1024,
      formats: ['mp4', 'mov'],
      codecs: ['h264', 'hevc'],
      minFps: 24,
      maxFps: 60,
    },
    ctaOptions: {
      customAllowed: false,
      presets: META_CTA_PRESETS,
    },
    safeZones: [
      { label: 'Profile + Actions', top: 0, left: 0, width: 100, height: 10 },
      { label: 'Bottom Bar', top: 90, left: 0, width: 100, height: 10 },
    ],
    captionGuidance: {
      maxCharsPerLine: 40,
      recommendedStyle: 'both',
      requiredForAccessibility: true,
    },
    audioGuidance: {
      musicAllowed: true,
      voiceoverRecommended: true,
      maxDbLevel: -14,
    },
  },
  {
    platform: 'meta',
    placement: 'meta-stories',
    displayName: 'Facebook/Instagram Stories',
    supportedTypes: ['image', 'video'],
    textLimits: {
      headline: { min: 1, max: 40, recommended: 27 },
      description: { min: 1, max: 125 },
    },
    imageSpec: {
      aspectRatios: [{ width: 9, height: 16, label: '9:16 Vertical' }],
      minWidth: 1080,
      minHeight: 1920,
      recommendedWidth: 1080,
      recommendedHeight: 1920,
      maxFileSize: 30 * 1024 * 1024,
      formats: ['jpg', 'png'],
    },
    videoSpec: {
      aspectRatios: [{ width: 9, height: 16, label: '9:16 Vertical' }],
      minDuration: 1,
      maxDuration: 120,
      recommendedDuration: 15,
      minWidth: 1080,
      minHeight: 1920,
      recommendedWidth: 1080,
      recommendedHeight: 1920,
      maxFileSize: 4 * 1024 * 1024 * 1024,
      formats: ['mp4', 'mov'],
      minFps: 24,
      maxFps: 30,
    },
    ctaOptions: {
      customAllowed: false,
      presets: META_CTA_PRESETS,
    },
    safeZones: [
      { label: 'Top Status Bar', top: 0, left: 0, width: 100, height: 14 },
      { label: 'Bottom CTA', top: 80, left: 0, width: 100, height: 20 },
    ],
    captionGuidance: {
      maxCharsPerLine: 35,
      recommendedStyle: 'burned-in',
      requiredForAccessibility: true,
    },
    audioGuidance: {
      musicAllowed: true,
      voiceoverRecommended: true,
      maxDbLevel: -14,
    },
  },
  {
    platform: 'meta',
    placement: 'meta-reels',
    displayName: 'Facebook/Instagram Reels',
    supportedTypes: ['video'],
    textLimits: {
      headline: { min: 1, max: 40 },
      description: { min: 1, max: 72 },
    },
    videoSpec: {
      aspectRatios: [{ width: 9, height: 16, label: '9:16 Vertical' }],
      minDuration: 3,
      maxDuration: 90,
      recommendedDuration: 30,
      minWidth: 1080,
      minHeight: 1920,
      recommendedWidth: 1080,
      recommendedHeight: 1920,
      maxFileSize: 4 * 1024 * 1024 * 1024,
      formats: ['mp4', 'mov'],
      minFps: 24,
      maxFps: 60,
    },
    ctaOptions: {
      customAllowed: false,
      presets: META_CTA_PRESETS,
    },
    safeZones: [
      { label: 'Top Bar', top: 0, left: 0, width: 100, height: 15 },
      { label: 'Right Actions', top: 30, left: 80, width: 20, height: 40 },
      { label: 'Bottom Info', top: 75, left: 0, width: 70, height: 25 },
    ],
    captionGuidance: {
      maxCharsPerLine: 35,
      recommendedStyle: 'burned-in',
      requiredForAccessibility: true,
    },
    audioGuidance: {
      musicAllowed: true,
      voiceoverRecommended: true,
      maxDbLevel: -14,
    },
  },
  {
    platform: 'meta',
    placement: 'meta-right-column',
    displayName: 'Facebook Right Column',
    supportedTypes: ['image'],
    textLimits: {
      headline: { min: 1, max: 40, recommended: 25 },
      description: { min: 1, max: 125 },
    },
    imageSpec: {
      aspectRatios: [{ width: 1, height: 1, label: '1:1 Square' }],
      minWidth: 254,
      minHeight: 254,
      recommendedWidth: 1080,
      recommendedHeight: 1080,
      maxFileSize: 30 * 1024 * 1024,
      formats: ['jpg', 'png'],
    },
    ctaOptions: {
      customAllowed: false,
      presets: META_CTA_PRESETS,
    },
  },
  {
    platform: 'meta',
    placement: 'meta-marketplace',
    displayName: 'Facebook Marketplace',
    supportedTypes: ['image', 'video'],
    textLimits: {
      headline: { min: 1, max: 40 },
      description: { min: 1, max: 125 },
      bodyText: { min: 1, max: 2200, recommended: 125 },
    },
    imageSpec: {
      aspectRatios: [{ width: 1, height: 1, label: '1:1 Square' }],
      minWidth: 600,
      minHeight: 600,
      recommendedWidth: 1080,
      recommendedHeight: 1080,
      maxFileSize: 30 * 1024 * 1024,
      formats: ['jpg', 'png'],
    },
    ctaOptions: {
      customAllowed: false,
      presets: META_CTA_PRESETS,
    },
  },
  {
    platform: 'meta',
    placement: 'meta-messenger',
    displayName: 'Messenger Inbox',
    supportedTypes: ['image'],
    textLimits: {
      headline: { min: 1, max: 40, recommended: 25 },
      description: { min: 1, max: 125 },
    },
    imageSpec: {
      aspectRatios: [{ width: 1, height: 1, label: '1:1 Square' }],
      minWidth: 254,
      minHeight: 254,
      recommendedWidth: 1080,
      recommendedHeight: 1080,
      maxFileSize: 30 * 1024 * 1024,
      formats: ['jpg', 'png'],
    },
    ctaOptions: {
      customAllowed: false,
      presets: META_CTA_PRESETS,
    },
  },
];

// ─── PINTEREST ──────────────────────────────────────
const PINTEREST_PLATFORM_INFO = {
  id: 'pinterest',
  name: 'Pinterest',
  iconName: 'pinterest',
  color: { light: '#E60023', dark: '#FF5C5C' },
  placements: [
    'pinterest-home-feed',
    'pinterest-search',
    'pinterest-browse',
    'pinterest-related-pins',
  ],
};

const PINTEREST_CTA_PRESETS = [
  'Learn More', 'Shop Now', 'Sign Up', 'Get Started', 'Visit Site',
  'Download', 'Install', 'Explore', 'Watch', 'Book Now',
];

const PINTEREST_SPECS = [
  {
    platform: 'pinterest',
    placement: 'pinterest-home-feed',
    displayName: 'Home Feed',
    supportedTypes: ['image', 'video', 'carousel'],
    textLimits: {
      headline: { min: 1, max: 100, recommended: 40 },
      description: { min: 1, max: 500, recommended: 100 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 2, height: 3, label: '2:3 Standard Pin' },
        { width: 1, height: 1, label: '1:1 Square' },
        { width: 4, height: 5, label: '4:5 Portrait' },
      ],
      minWidth: 600,
      minHeight: 600,
      recommendedWidth: 1000,
      recommendedHeight: 1500,
      maxFileSize: 20 * 1024 * 1024,
      formats: ['jpg', 'png'],
      maxTextOverlay: 20,
    },
    videoSpec: {
      aspectRatios: [
        { width: 1, height: 1, label: '1:1 Square' },
        { width: 2, height: 3, label: '2:3 Standard' },
        { width: 9, height: 16, label: '9:16 Full Screen' },
      ],
      minDuration: 4,
      maxDuration: 900,
      recommendedDuration: 15,
      minWidth: 240,
      minHeight: 240,
      recommendedWidth: 1080,
      recommendedHeight: 1920,
      maxFileSize: 2 * 1024 * 1024 * 1024,
      formats: ['mp4', 'mov', 'm4v'],
      codecs: ['h264'],
      minFps: 24,
      maxFps: 30,
    },
    ctaOptions: {
      customAllowed: false,
      presets: PINTEREST_CTA_PRESETS,
    },
  },
  {
    platform: 'pinterest',
    placement: 'pinterest-search',
    displayName: 'Search Results',
    supportedTypes: ['image', 'video'],
    textLimits: {
      headline: { min: 1, max: 100, recommended: 40 },
      description: { min: 1, max: 500, recommended: 100 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 2, height: 3, label: '2:3 Standard Pin' },
        { width: 1, height: 1, label: '1:1 Square' },
      ],
      minWidth: 600,
      minHeight: 600,
      recommendedWidth: 1000,
      recommendedHeight: 1500,
      maxFileSize: 20 * 1024 * 1024,
      formats: ['jpg', 'png'],
    },
    ctaOptions: {
      customAllowed: false,
      presets: PINTEREST_CTA_PRESETS,
    },
  },
  {
    platform: 'pinterest',
    placement: 'pinterest-browse',
    displayName: 'Browse',
    supportedTypes: ['image', 'video', 'carousel'],
    textLimits: {
      headline: { min: 1, max: 100, recommended: 40 },
      description: { min: 1, max: 500 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 2, height: 3, label: '2:3 Standard Pin' },
        { width: 1, height: 1, label: '1:1 Square' },
      ],
      minWidth: 600,
      minHeight: 600,
      recommendedWidth: 1000,
      recommendedHeight: 1500,
      maxFileSize: 20 * 1024 * 1024,
      formats: ['jpg', 'png'],
    },
    ctaOptions: {
      customAllowed: false,
      presets: PINTEREST_CTA_PRESETS,
    },
  },
  {
    platform: 'pinterest',
    placement: 'pinterest-related-pins',
    displayName: 'Related Pins',
    supportedTypes: ['image'],
    textLimits: {
      headline: { min: 1, max: 100, recommended: 40 },
      description: { min: 1, max: 500 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 2, height: 3, label: '2:3 Standard Pin' },
      ],
      minWidth: 600,
      minHeight: 900,
      recommendedWidth: 1000,
      recommendedHeight: 1500,
      maxFileSize: 20 * 1024 * 1024,
      formats: ['jpg', 'png'],
    },
    ctaOptions: {
      customAllowed: false,
      presets: PINTEREST_CTA_PRESETS,
    },
  },
];

// ─── REDDIT ──────────────────────────────────────
const REDDIT_PLATFORM_INFO = {
  id: 'reddit',
  name: 'Reddit',
  iconName: 'reddit',
  color: { light: '#FF4500', dark: '#FF6B3D' },
  placements: [
    'reddit-feed',
    'reddit-conversation',
    'reddit-trending',
  ],
};

const REDDIT_CTA_PRESETS = [
  'Learn More', 'Sign Up', 'Download', 'Shop Now', 'Get Started',
  'Apply Now', 'Contact Us', 'Book Now', 'Watch Now', 'Install App',
];

const REDDIT_SPECS = [
  {
    platform: 'reddit',
    placement: 'reddit-feed',
    displayName: 'Feed Ad',
    supportedTypes: ['image', 'video', 'carousel'],
    textLimits: {
      headline: { min: 1, max: 300, recommended: 100 },
      bodyText: { min: 1, max: 300 },
      displayUrl: { max: 25 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 1, height: 1, label: '1:1 Square' },
        { width: 4, height: 3, label: '4:3 Landscape' },
        { width: 16, height: 9, label: '16:9 Widescreen' },
      ],
      minWidth: 400,
      minHeight: 300,
      recommendedWidth: 1200,
      recommendedHeight: 628,
      maxFileSize: 3 * 1024 * 1024,
      formats: ['jpg', 'png', 'gif'],
      maxTextOverlay: 30,
    },
    videoSpec: {
      aspectRatios: [
        { width: 1, height: 1, label: '1:1 Square' },
        { width: 4, height: 5, label: '4:5 Portrait' },
        { width: 16, height: 9, label: '16:9 Widescreen' },
      ],
      minDuration: 1,
      maxDuration: 180,
      recommendedDuration: 30,
      minWidth: 720,
      minHeight: 720,
      recommendedWidth: 1920,
      recommendedHeight: 1080,
      maxFileSize: 1024 * 1024 * 1024,
      formats: ['mp4', 'mov'],
      codecs: ['h264'],
      minFps: 24,
      maxFps: 60,
    },
    ctaOptions: {
      customAllowed: true,
      presets: REDDIT_CTA_PRESETS,
    },
  },
  {
    platform: 'reddit',
    placement: 'reddit-conversation',
    displayName: 'Conversation Placement',
    supportedTypes: ['image', 'video'],
    textLimits: {
      headline: { min: 1, max: 300, recommended: 100 },
      bodyText: { min: 1, max: 300 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 1, height: 1, label: '1:1 Square' },
        { width: 4, height: 3, label: '4:3 Landscape' },
      ],
      minWidth: 400,
      minHeight: 300,
      recommendedWidth: 1200,
      recommendedHeight: 628,
      maxFileSize: 3 * 1024 * 1024,
      formats: ['jpg', 'png'],
    },
    videoSpec: {
      aspectRatios: [
        { width: 1, height: 1, label: '1:1 Square' },
        { width: 16, height: 9, label: '16:9 Widescreen' },
      ],
      minDuration: 1,
      maxDuration: 60,
      recommendedDuration: 15,
      minWidth: 720,
      minHeight: 720,
      recommendedWidth: 1920,
      recommendedHeight: 1080,
      maxFileSize: 512 * 1024 * 1024,
      formats: ['mp4', 'mov'],
      minFps: 24,
      maxFps: 30,
    },
    ctaOptions: {
      customAllowed: true,
      presets: REDDIT_CTA_PRESETS,
    },
  },
  {
    platform: 'reddit',
    placement: 'reddit-trending',
    displayName: 'Trending Takeover',
    supportedTypes: ['image'],
    textLimits: {
      headline: { min: 1, max: 100, recommended: 50 },
      bodyText: { min: 1, max: 200 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 16, height: 9, label: '16:9 Widescreen' },
        { width: 4, height: 3, label: '4:3 Landscape' },
      ],
      minWidth: 1200,
      minHeight: 628,
      recommendedWidth: 1200,
      recommendedHeight: 628,
      maxFileSize: 3 * 1024 * 1024,
      formats: ['jpg', 'png'],
    },
    ctaOptions: {
      customAllowed: true,
      presets: REDDIT_CTA_PRESETS,
    },
  },
];

// ─── SNAPCHAT ──────────────────────────────────────
const SNAPCHAT_PLATFORM_INFO = {
  id: 'snapchat',
  name: 'Snapchat',
  iconName: 'snapchat',
  color: { light: '#FFFC00', dark: '#FFFC00' },
  placements: [
    'snapchat-single-image',
    'snapchat-single-video',
    'snapchat-story',
    'snapchat-collection',
    'snapchat-lenses',
  ],
};

const SNAPCHAT_CTA_PRESETS = [
  'Shop Now', 'Install Now', 'Sign Up', 'Watch', 'View', 'Apply Now',
  'Book Now', 'Download', 'Order Now', 'More', 'Play', 'Get',
];

const SNAPCHAT_SPECS = [
  {
    platform: 'snapchat',
    placement: 'snapchat-single-image',
    displayName: 'Single Image Ad',
    supportedTypes: ['image'],
    textLimits: {
      headline: { min: 1, max: 34, recommended: 25 },
      description: { min: 1, max: 34 },
      ctaText: { min: 1, max: 20 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 9, height: 16, label: '9:16 Full Screen' },
      ],
      minWidth: 1080,
      minHeight: 1920,
      recommendedWidth: 1080,
      recommendedHeight: 1920,
      maxFileSize: 5 * 1024 * 1024,
      formats: ['jpg', 'png'],
    },
    ctaOptions: {
      customAllowed: true,
      presets: SNAPCHAT_CTA_PRESETS,
    },
    safeZones: [
      { label: 'Top Bar', top: 0, left: 0, width: 100, height: 10 },
      { label: 'Bottom CTA', top: 82, left: 0, width: 100, height: 18 },
    ],
  },
  {
    platform: 'snapchat',
    placement: 'snapchat-single-video',
    displayName: 'Single Video Ad',
    supportedTypes: ['video'],
    textLimits: {
      headline: { min: 1, max: 34, recommended: 25 },
      description: { min: 1, max: 34 },
      ctaText: { min: 1, max: 20 },
    },
    videoSpec: {
      aspectRatios: [
        { width: 9, height: 16, label: '9:16 Full Screen' },
      ],
      minDuration: 3,
      maxDuration: 180,
      recommendedDuration: 6,
      minWidth: 1080,
      minHeight: 1920,
      recommendedWidth: 1080,
      recommendedHeight: 1920,
      maxFileSize: 1024 * 1024 * 1024,
      formats: ['mp4', 'mov'],
      codecs: ['h264', 'hevc'],
      minFps: 24,
      maxFps: 30,
    },
    ctaOptions: {
      customAllowed: true,
      presets: SNAPCHAT_CTA_PRESETS,
    },
    safeZones: [
      { label: 'Top Bar', top: 0, left: 0, width: 100, height: 10 },
      { label: 'Bottom CTA', top: 82, left: 0, width: 100, height: 18 },
    ],
  },
  {
    platform: 'snapchat',
    placement: 'snapchat-story',
    displayName: 'Story Ad',
    supportedTypes: ['image', 'video'],
    textLimits: {
      headline: { min: 1, max: 34, recommended: 25 },
      description: { min: 1, max: 34 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 9, height: 16, label: '9:16 Full Screen' },
      ],
      minWidth: 1080,
      minHeight: 1920,
      recommendedWidth: 1080,
      recommendedHeight: 1920,
      maxFileSize: 5 * 1024 * 1024,
      formats: ['jpg', 'png'],
    },
    videoSpec: {
      aspectRatios: [
        { width: 9, height: 16, label: '9:16 Full Screen' },
      ],
      minDuration: 3,
      maxDuration: 180,
      recommendedDuration: 6,
      minWidth: 1080,
      minHeight: 1920,
      recommendedWidth: 1080,
      recommendedHeight: 1920,
      maxFileSize: 1024 * 1024 * 1024,
      formats: ['mp4', 'mov'],
      minFps: 24,
      maxFps: 30,
    },
    ctaOptions: {
      customAllowed: true,
      presets: SNAPCHAT_CTA_PRESETS,
    },
    safeZones: [
      { label: 'Top Bar', top: 0, left: 0, width: 100, height: 12 },
      { label: 'Story Controls', top: 85, left: 0, width: 100, height: 15 },
    ],
  },
  {
    platform: 'snapchat',
    placement: 'snapchat-collection',
    displayName: 'Collection Ad',
    supportedTypes: ['image', 'video', 'carousel'],
    textLimits: {
      headline: { min: 1, max: 34 },
      description: { min: 1, max: 55 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 9, height: 16, label: '9:16 Full Screen' },
      ],
      minWidth: 1080,
      minHeight: 1920,
      recommendedWidth: 1080,
      recommendedHeight: 1920,
      maxFileSize: 5 * 1024 * 1024,
      formats: ['jpg', 'png'],
    },
    videoSpec: {
      aspectRatios: [
        { width: 9, height: 16, label: '9:16 Full Screen' },
      ],
      minDuration: 3,
      maxDuration: 180,
      recommendedDuration: 10,
      minWidth: 1080,
      minHeight: 1920,
      recommendedWidth: 1080,
      recommendedHeight: 1920,
      maxFileSize: 1024 * 1024 * 1024,
      formats: ['mp4', 'mov'],
      minFps: 24,
      maxFps: 30,
    },
    ctaOptions: {
      customAllowed: true,
      presets: SNAPCHAT_CTA_PRESETS,
    },
  },
  {
    platform: 'snapchat',
    placement: 'snapchat-lenses',
    displayName: 'Sponsored Lenses',
    supportedTypes: ['image'], // Base image for lens trigger
    textLimits: {
      headline: { min: 1, max: 34 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 1, height: 1, label: '1:1 Square Thumbnail' },
      ],
      minWidth: 150,
      minHeight: 150,
      recommendedWidth: 200,
      recommendedHeight: 200,
      maxFileSize: 1 * 1024 * 1024,
      formats: ['png'],
    },
    ctaOptions: {
      customAllowed: false,
      presets: ['Try Lens'],
    },
  },
];

// ─── TIKTOK ──────────────────────────────────────
const TIKTOK_PLATFORM_INFO = {
  id: 'tiktok',
  name: 'TikTok Ads',
  iconName: 'tiktok',
  color: { light: '#000000', dark: '#FFFFFF' },
  placements: ['tiktok-feed', 'tiktok-topview'],
};

const TIKTOK_SPECS = [
  {
    platform: 'tiktok',
    placement: 'tiktok-feed',
    displayName: 'TikTok In-Feed',
    supportedTypes: ['image', 'video'],
    textLimits: {
      headline: { min: 1, max: 100, recommended: 50 },
      description: { min: 1, max: 100, recommended: 80 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 9, height: 16, label: '9:16 Vertical' },
        { width: 1, height: 1, label: '1:1 Square' },
      ],
      minWidth: 720,
      minHeight: 1280,
      recommendedWidth: 1080,
      recommendedHeight: 1920,
      maxFileSize: 20 * 1024 * 1024,
      formats: ['jpg', 'png'],
    },
    videoSpec: {
      aspectRatios: [
        { width: 9, height: 16, label: '9:16 Vertical' },
        { width: 1, height: 1, label: '1:1 Square' },
        { width: 16, height: 9, label: '16:9 Landscape' },
      ],
      minDuration: 5,
      maxDuration: 60,
      recommendedDuration: 21,
      minWidth: 720,
      minHeight: 1280,
      recommendedWidth: 1080,
      recommendedHeight: 1920,
      maxFileSize: 500 * 1024 * 1024,
      formats: ['mp4', 'mov', 'avi'],
      codecs: ['h264', 'hevc'],
      minFps: 24,
      maxFps: 60,
    },
    ctaOptions: {
      customAllowed: false,
      presets: [
        'Learn More', 'Shop Now', 'Sign Up', 'Download', 'Contact Us',
        'Apply Now', 'Book Now', 'Get Quote', 'Subscribe', 'Order Now',
      ],
    },
    safeZones: [
      { label: 'Right Actions', top: 35, left: 82, width: 18, height: 30 },
      { label: 'Bottom Caption', top: 75, left: 0, width: 75, height: 25 },
    ],
    captionGuidance: {
      maxCharsPerLine: 34,
      recommendedStyle: 'burned-in',
      requiredForAccessibility: true,
    },
    audioGuidance: {
      musicAllowed: true,
      voiceoverRecommended: true,
      maxDbLevel: -14,
    },
  },
  {
    platform: 'tiktok',
    placement: 'tiktok-topview',
    displayName: 'TikTok TopView',
    supportedTypes: ['video'],
    textLimits: {
      headline: { min: 1, max: 100, recommended: 50 },
      description: { min: 1, max: 100 },
    },
    videoSpec: {
      aspectRatios: [{ width: 9, height: 16, label: '9:16 Vertical' }],
      minDuration: 5,
      maxDuration: 60,
      recommendedDuration: 15,
      minWidth: 1080,
      minHeight: 1920,
      recommendedWidth: 1080,
      recommendedHeight: 1920,
      maxFileSize: 500 * 1024 * 1024,
      formats: ['mp4', 'mov'],
      codecs: ['h264', 'hevc'],
      minFps: 24,
      maxFps: 60,
    },
    ctaOptions: {
      customAllowed: false,
      presets: ['Learn More', 'Shop Now', 'Download', 'Sign Up'],
    },
    safeZones: [
      { label: 'Top Status', top: 0, left: 0, width: 100, height: 12 },
      { label: 'Bottom CTA', top: 85, left: 0, width: 100, height: 15 },
    ],
    captionGuidance: {
      maxCharsPerLine: 34,
      recommendedStyle: 'burned-in',
      requiredForAccessibility: true,
    },
    audioGuidance: {
      musicAllowed: true,
      voiceoverRecommended: true,
      maxDbLevel: -14,
    },
  },
];

// ─── X ──────────────────────────────────────
const X_PLATFORM_INFO = {
  id: 'x',
  name: 'X (Twitter) Ads',
  iconName: 'x',
  color: { light: '#000000', dark: '#FFFFFF' },
  placements: ['x-timeline', 'x-explore'],
};

const X_SPECS = [
  {
    platform: 'x',
    placement: 'x-timeline',
    displayName: 'X Timeline (Promoted Posts)',
    supportedTypes: ['image', 'video', 'carousel'],
    textLimits: {
      headline: { min: 1, max: 280, recommended: 100 },
      description: { min: 1, max: 280 },
    },
    imageSpec: {
      aspectRatios: [
        { width: 16, height: 9, label: '16:9 Landscape' },
        { width: 1, height: 1, label: '1:1 Square' },
      ],
      minWidth: 600,
      minHeight: 335,
      recommendedWidth: 1200,
      recommendedHeight: 675,
      maxFileSize: 5 * 1024 * 1024,
      formats: ['jpg', 'png', 'gif', 'webp'],
    },
    videoSpec: {
      aspectRatios: [
        { width: 16, height: 9, label: '16:9 Landscape' },
        { width: 1, height: 1, label: '1:1 Square' },
        { width: 9, height: 16, label: '9:16 Vertical' },
      ],
      minDuration: 1,
      maxDuration: 140,
      recommendedDuration: 15,
      minWidth: 640,
      minHeight: 360,
      recommendedWidth: 1920,
      recommendedHeight: 1080,
      maxFileSize: 512 * 1024 * 1024,
      formats: ['mp4', 'mov'],
      codecs: ['h264'],
      minFps: 24,
      maxFps: 60,
    },
    ctaOptions: {
      customAllowed: false,
      presets: ['Visit Site', 'Shop Now', 'Learn More', 'Install', 'Book Now'],
    },
  },
  {
    platform: 'x',
    placement: 'x-explore',
    displayName: 'X Explore Tab',
    supportedTypes: ['image', 'video'],
    textLimits: {
      headline: { min: 1, max: 70, recommended: 50 },
      description: { min: 1, max: 280 },
    },
    imageSpec: {
      aspectRatios: [{ width: 16, height: 9, label: '16:9 Landscape' }],
      minWidth: 600,
      minHeight: 335,
      recommendedWidth: 1200,
      recommendedHeight: 675,
      maxFileSize: 5 * 1024 * 1024,
      formats: ['jpg', 'png'],
    },
    videoSpec: {
      aspectRatios: [{ width: 16, height: 9, label: '16:9 Landscape' }],
      minDuration: 6,
      maxDuration: 60,
      recommendedDuration: 15,
      minWidth: 1280,
      minHeight: 720,
      recommendedWidth: 1920,
      recommendedHeight: 1080,
      maxFileSize: 512 * 1024 * 1024,
      formats: ['mp4', 'mov'],
      codecs: ['h264'],
      minFps: 24,
      maxFps: 30,
    },
    ctaOptions: {
      customAllowed: false,
      presets: ['Visit Site', 'Shop Now', 'Learn More'],
    },
  },
];
// ─── REGISTRY ASSEMBLY ──────────────────────────────────

const PLATFORM_INFO_MAP = {
  amazon: AMAZON_PLATFORM_INFO,
  google: GOOGLE_PLATFORM_INFO,
  linkedin: LINKEDIN_PLATFORM_INFO,
  meta: META_PLATFORM_INFO,
  pinterest: PINTEREST_PLATFORM_INFO,
  reddit: REDDIT_PLATFORM_INFO,
  snapchat: SNAPCHAT_PLATFORM_INFO,
  tiktok: TIKTOK_PLATFORM_INFO,
  x: X_PLATFORM_INFO,
};

const ALL_SPECS = [
  ...AMAZON_SPECS,
  ...GOOGLE_SPECS,
  ...LINKEDIN_SPECS,
  ...META_SPECS,
  ...PINTEREST_SPECS,
  ...REDDIT_SPECS,
  ...SNAPCHAT_SPECS,
  ...TIKTOK_SPECS,
  ...X_SPECS,
];

const specsByPlacement = new Map();
const specsByPlatform = new Map();
for (const spec of ALL_SPECS) {
  specsByPlacement.set(spec.placement, spec);
  const existing = specsByPlatform.get(spec.platform) || [];
  existing.push(spec);
  specsByPlatform.set(spec.platform, existing);
}

function getSpecSet(platforms, placements) {
  const platformsArr = Array.isArray(platforms) ? platforms : [];
  let specs;
  if (Array.isArray(placements) && placements.length > 0) {
    specs = placements
      .map((p) => specsByPlacement.get(p))
      .filter((s) => s !== undefined);
  } else {
    specs = platformsArr.flatMap((p) => specsByPlatform.get(p) || []);
  }
  return { platforms: platformsArr, specs };
}

// ─── EXECUTOR ───────────────────────────────────────────

export async function platformSpecs(ctx) {
  const log = makeLog(ctx);
  const inputs = ctx.inputs ?? {};
  if (!Array.isArray(inputs.platforms)) {
    return {
      status: 'error',
      error: { code: 'INVALID_INPUTS', message: 'platforms[] required', retryable: false },
    };
  }
  log.info('Resolving platform specs', {
    platforms: inputs.platforms,
    placementsCount: Array.isArray(inputs.placements) ? inputs.placements.length : 0,
  });
  const specSet = getSpecSet(inputs.platforms, inputs.placements);
  return {
    status: 'success',
    outputs: { specSet, specCount: specSet.specs.length, success: true },
  };
}

const nodes = {
  'ads.platform.specs': platformSpecs,
};

export default nodes;
