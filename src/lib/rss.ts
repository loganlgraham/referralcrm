import Parser from 'rss-parser';

export type RssArticle = {
  title: string;
  link: string;
  pubDate: string;
  source: string;
};

const FEEDS: { url: string; source: string }[] = [
  { url: 'https://www.realtor.com/news/feed', source: 'Realtor.com' },
  { url: 'https://www.redfin.com/news/feed', source: 'Redfin' },
  { url: 'https://www.housingwire.com/feed', source: 'HousingWire' },
  { url: 'https://www.mortgagenewsdaily.com/rss/news', source: 'Mortgage News Daily' },
];

const parser = new Parser({ timeout: 8000 });

export async function fetchRssNews(): Promise<RssArticle[]> {
  const results = await Promise.allSettled(
    FEEDS.map(async ({ url, source }) => {
      const feed = await parser.parseURL(url);
      return (feed.items ?? []).map((item) => ({
        title: item.title ?? '',
        link: item.link ?? '',
        pubDate: item.pubDate ?? item.isoDate ?? '',
        source,
      }));
    })
  );

  const articles: RssArticle[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      articles.push(...result.value);
    }
  }

  return articles
    .filter((a) => a.title && a.link)
    .sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
      return db - da;
    })
    .slice(0, 10);
}
