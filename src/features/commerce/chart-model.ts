export type ChartPeriod=7|30|90;
export type DailyChartPoint={day:string;visits:number|null;requests:number};
export type DailyChartData={period:ChartPeriod;points:DailyChartPoint[];knownVisitDays:number};
const dayMs=86400000;
export function dateDaysAgo(today:string,days:number){return new Date(Date.parse(today+"T00:00:00Z")-days*dayMs).toISOString().slice(0,10);}
export function dailyChartData(period:ChartPeriod,today:string,visits:Map<string,number>,requests:Map<string,number>):DailyChartData {
  const retainedSince=dateDaysAgo(today,35); // Existing RPC deletes days older than this boundary.
  const points=Array.from({length:period},(_,i)=>{
    const day=dateDaysAgo(today,period-i-1);
    return {day,visits:day<retainedSince?null:visits.get(day)??0,requests:requests.get(day)??0};
  });
  return {period,points,knownVisitDays:points.filter(p=>p.visits!==null).length};
}
export function chartScale(max:number) {
  const target=Math.max(1,max)/4,power=10**Math.floor(Math.log10(target));
  const step=Math.max(1,([1,2,5,10].find(n=>n*power>=target)??10)*power);
  const top=step*4;
  return {top,ticks:Array.from({length:5},(_,i)=>i*step)};
}
/** PostgREST keyset pagination: stable across insertions, bounded memory on the server. */
export function afterChartCursor(fields:readonly string[],last:Record<string,string>) {
  return fields.map((field,i)=>{
    const predicates=[...fields.slice(0,i).map(key=>`${key}.eq.${JSON.stringify(last[key])}`),`${field}.gt.${JSON.stringify(last[field])}`];
    return predicates.length===1?predicates[0]:`and(${predicates.join(",")})`;
  }).join(",");
}
