const cheerio = require('cheerio');
const dayjs = require('dayjs');
const logger = require('../../utils/logger');
const URI = require('urijs');
const { art } = require('@/utils/render');
const path = require('path');

const got = require('@/utils/got');

module.exports = async (ctx) => {
    const rootUrl = `https://www.gamersky.com`;
    const out = [];

    const formatUrl = (url) => {
        if (!url) {
            return url;
        }
        let uri = URI(url);
        if (!uri.origin()) {
            uri = uri.origin(rootUrl);
        }
        return uri.toString();
    };
    try {
        const res = await got.get(rootUrl);
        const $ = cheerio.load(res.data);
        const $body = $('body');
        const $li = $body.find('div.Mid > div.Mid1 > div.Mid1_M > div:nth-child(1) > div.Mid1Mcon.block > ul.Ptxt li').filter(function () {
            const $this = $(this);
            return !!$this.text().trim();
        });
        const list = $li.get();
        // logger.info(`新闻数量：${list.length}`);
        await Promise.all(
            list.map(async (item) => {
                let link;
                try {
                    let pubDate;
                    const $ = cheerio.load(item, { decodeEntities: false });
                    const title = $(item).find('a').attr('title');
                    link = formatUrl($(item).find('a').attr('href'));
                    const cache = await ctx.cache.get(link);
                    if (cache) {
                        return out.push(JSON.parse(cache));
                    }
                    let description = '';
                    const getContent = async (url) => {
                        let res;
                        try {
                            res = await got.get(url);
                        } catch (e) {
                            logger.error(e.message);
                            throw new Error(`获取地址失败：${url}`);
                        }
                        const $detail = cheerio.load(res.data, { decodeEntities: false });
                        let $content = $detail('.Mid2L_con,.qzcmt-content,.MidL_con,.MidLcon');
                        const $next = $content.find(".page_css a:contains('下一页')");
                        let dateStr = $detail('body > div.Mid > div.Mid2 > div.Mid2_L > div.Mid2L_tit > div > div.con > div.bott > span.time').text();
                        if (!dateStr) {
                            let detail = $detail('.Mid2L_tit>.detail').text();
                            if (detail) {
                                detail = detail.replace(/^\s+|\s+$/g, '');
                                dateStr = detail.substr(0, 19);
                            }
                        }
                        if (dateStr) {
                            const date = dayjs(dateStr);
                            if (date.isValid()) {
                                pubDate = dayjs(dateStr).toDate();
                            }
                        }

                        if ($content.length === 0) {
                            throw new Error(`获取正文失败，地址：${url}，标题：${title}`);
                        } else if ($content.length) {
                            $content = $content.eq(0);
                            $content.find('img').each(function () {
                                const $this = $(this);
                                $this.parents('a').attr('href', 'javascript:void(0);');
                                const realSrc = $this.attr('data-small') || $this.attr('data-src') || $this.attr('sourceimagesrc');
                                if (realSrc) {
                                    $this.attr('src', realSrc);
                                }
                            });
                            $content.find('.page_css').remove();
                            description += $content.html();
                        }
                        if ($next.length) {
                            await getContent(formatUrl($next.attr('href')));
                        }
                    };

                    await getContent(link);

                    if (!description) {
                        description = title;
                    }

                    const single = {
                        title,
                        pubDate,
                        link,
                        guid: link,
                        description: art(path.join(__dirname, 'templates/content.art'), {
                            content: description,
                        }),
                    };
                    ctx.cache.set(link, JSON.stringify(single));
                    out.push(single);
                } catch (e) {
                    if (link) {
                        logger.error(`获取新闻失败，地址：${link}，失败原因：${e.message}`);
                    } else {
                        logger.error(e.message);
                    }
                }
            })
        );
        ctx.state.data = {
            title: '游民星空今日要闻',
            link: rootUrl,
            item: out,
        };
    } catch (e) {
        // console.error(e);
        logger.error(`gamersky/today-news错误：${e.message}`);
    }
};
