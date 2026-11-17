const routes = ["/admin/analytics", "/admin/orders", "/admin/customers", "/admin/staff"];

/** Fixed internal destinations only: no arbitrary post-login redirects. */
export function adminReturnPath(value?: string) {
  return routes.includes(value ?? "") ? value! : "/admin/analytics";
}
