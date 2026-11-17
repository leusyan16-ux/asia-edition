export const dashboardRefreshInterval=30_000;
type RefreshEnvironment={
  refresh:()=>void;busy:()=>boolean;visible:()=>boolean;online:()=>boolean;now:()=>number;
  interval:(callback:()=>void,milliseconds:number)=>unknown;clear:(timer:unknown)=>void;
  listen:(event:"visibilitychange"|"focus"|"online",callback:()=>void)=>()=>void;
};
/** No document reload, URL changes or parallel refreshes. Suspended tabs catch up on return. */
export function scheduleDashboardRefresh(env:RefreshEnvironment){
  let lastAttempt:number|null=null,stopped=false;
  const tick=()=>{
    if(stopped||env.busy()||!env.visible()||!env.online())return;
    const now=env.now();
    if(lastAttempt!==null&&now-lastAttempt<1000)return;
    lastAttempt=now;env.refresh();
  };
  const timer=env.interval(tick,dashboardRefreshInterval);
  const listeners=(["visibilitychange","focus","online"] as const).map(event=>env.listen(event,tick));
  return Object.assign(()=>{stopped=true;env.clear(timer);listeners.forEach(remove=>remove());},{refreshNow:tick});
}
