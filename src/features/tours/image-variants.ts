/** Resize only the same approved public asset. scale-down never fabricates resolution. */
export function tourImageVariant(source: string, width: number) {
  try {
    const u = new URL(source);
    if (
      u.protocol !== "https:" ||
      u.hostname !== "cdn.getyourguide.com" ||
      u.username ||
      u.password ||
      u.port ||
      u.search ||
      u.hash ||
      !/^\/image\/format=[^/]+\/(?:tour_img|tour_img1|tour_img2)\//.test(
        u.pathname,
      ) ||
      ![480, 800, 1000, 1600, 2000].includes(width)
    )
      return source;
    return source.replace(
      /\/image\/[^/]+\//,
      `/image/format=auto%2Cfit=scale-down%2Cquality=85%2Cwidth=${width}/`,
    );
  } catch {
    return source;
  }
}
