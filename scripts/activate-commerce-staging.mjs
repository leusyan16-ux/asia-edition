import { readFile } from "node:fs/promises";
import pg from "pg";

const ref = "xnnxmhwvixrqenunhhbt";
const verification = `
  select count(*)::int as getyourguide_total,
         count(*) filter (where requestable)::int as requestable,
         count(*) filter (where slug = any($1::text[]))::int as matched,
         (select requests_enabled from public.commerce_settings where id = 1)
           as requests_enabled
  from public.commerce_products
  where provider = 'getyourguide'
`;

async function main() {
  let client;
  let phase = "configuration";
  let transaction = "not started";
  try {
    process.stdin.setEncoding("utf8");
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const { host, caPath, password } = JSON.parse(input);
    if (typeof host !== "string" ||
        (host && !/^[a-z0-9]+(?:-[a-z0-9]+)+\.pooler\.supabase\.com$/.test(host)) ||
        typeof password !== "string" || !password) throw Error();
    const ca = await readFile(caPath, "utf8");
    if (!ca.includes("-----BEGIN CERTIFICATE-----")) throw Error();
    const sql = await readFile(new URL("../qa/commerce-chat-staging-activate.sql", import.meta.url), "utf8");
    const transactionBody = sql.match(/^--[^\n]*\nbegin;\s*([\s\S]+)\ncommit;\s*select requests_enabled,[^\n]+\s*$/i)?.[1];
    if (!transactionBody) throw Error();
    const slugs = [...transactionBody.matchAll(/^insert into public\.commerce_products\(slug,[^\n]+?values\('(getyourguide-\d+)'/gm)]
      .map((match) => match[1]);
    if (slugs.length !== 2319 || new Set(slugs).size !== slugs.length) throw Error();

    phase = "connecting to staging";
    client = new pg.Client({
      host: host || `db.${ref}.supabase.co`,
      user: host ? `postgres.${ref}` : "postgres",
      port: 5432,
      database: "postgres",
      password,
      ssl: { ca, rejectUnauthorized: true },
      connectionTimeoutMillis: 15000,
      statement_timeout: 120000,
    });
    client.on("error", () => {});
    await client.connect();
    phase = "importing";
    await client.query("BEGIN");
    transaction = "open";
    await client.query(transactionBody);
    const { rows: [before] } = await client.query(verification, [slugs]);
    if (before.matched !== slugs.length || before.requestable < 1 || !before.requests_enabled)
      throw Error();

    phase = "committing";
    transaction = "commit not confirmed";
    const result = await client.query("COMMIT");
    if (result.command !== "COMMIT") {
      transaction = "rolled back";
      throw Error();
    }
    transaction = "committed";
    phase = "verifying after commit";
    const { rows: [after] } = await client.query(verification, [slugs]);
    if (after.matched !== slugs.length || after.requestable < 1 || !after.requests_enabled)
      throw Error();
    console.log(JSON.stringify({ staging: ref, transaction, ...after }));
  } catch (error) {
    if (transaction === "open") {
      try {
        await client.query("ROLLBACK");
        transaction = "rolled back";
      } catch {
        transaction = "rollback not confirmed";
      }
    }
    const code = /^[A-Z0-9_]{3,40}$/.test(error?.code ?? "") ? ` [${error.code}]` : "";
    console.error(`Staging activation failed while ${phase}${code}. Transaction: ${transaction}.`);
    process.exitCode = 1;
  } finally {
    await client?.end().catch(() => {});
  }
}

void main();
