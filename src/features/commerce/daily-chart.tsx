"use client";
import { useEffect,useRef,useState } from "react";
import { chartScale,type DailyChartData } from "./chart-model";

const number=new Intl.NumberFormat("ru-RU"),shortNumber=new Intl.NumberFormat("ru-RU",{notation:"compact",maximumFractionDigits:1});
const fullDate=(day:string)=>new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(day+"T00:00:00Z"));
const shortDate=(day:string)=>new Intl.DateTimeFormat("ru-RU",{day:"2-digit",month:"2-digit",timeZone:"UTC"}).format(new Date(day+"T00:00:00Z"));
export function DailyActivityChart({data,summaryPeriod=7}:{data:DailyChartData;summaryPeriod?:1|7|30}) {
  const wrap=useRef<HTMLDivElement>(null);
  const [viewport,setViewport]=useState(780),[active,setActive]=useState<number|null>(null),[pinned,setPinned]=useState(false),[tipX,setTipX]=useState(12);
  useEffect(()=>{
    const node=wrap.current;if(!node)return;
    const observer=new ResizeObserver(entries=>setViewport(Math.max(280,entries[0].contentRect.width)));
    observer.observe(node);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    // Long periods open at the most recent dates, not an empty historical edge.
    const node=wrap.current;if(node)node.scrollLeft=node.scrollWidth;
  },[data.period,viewport]);
  const width=Math.max(viewport,data.period===90?1500:data.period===30?760:320),left=54,right=20,top=40,bottom=244,plotWidth=width-left-right;
  const cell=plotWidth/data.points.length,bar=Math.min(14,cell*.28);
  const scale=chartScale(Math.max(0,...data.points.flatMap(p=>[p.visits??0,p.requests])));
  const y=(n:number)=>bottom-(n/scale.top)*(bottom-top);
  const visits=data.points.reduce((sum,p)=>sum+(p.visits??0),0),requests=data.points.reduce((sum,p)=>sum+p.requests,0);
  const selected=active===null?null:data.points[active];
  const show=(i:number,node:SVGGElement)=>{
    setActive(i);
    const box=node.getBoundingClientRect(),parent=wrap.current?.getBoundingClientRect();
    setTipX(Math.max(6,Math.min(viewport-260,box.left+(box.width/2)-(parent?.left??0)-125)));
  };
  return <section className="daily-activity" aria-labelledby="daily-activity-title">
    <div className="daily-chart-heading"><div><h2 id="daily-activity-title">Посещения и заявки по дням</h2><p>{fullDate(data.points[0].day)} — {fullDate(data.points[data.points.length-1].day)} · UTC</p></div>
      <nav className="daily-chart-period" aria-label="Период графика">{([7,30,90] as const).map(n=><a key={n} href={`/admin/analytics?days=${summaryPeriod}&chartDays=${n}`} aria-current={data.period===n?"page":undefined}>{n} дней</a>)}</nav>
    </div>
    <dl className="daily-chart-totals"><div><dt><span className="chart-swatch visits"/>Посещения за период</dt><dd>{number.format(visits)}{data.knownVisitDays<data.period&&<small>по доступным {data.knownVisitDays} дням</small>}</dd></div><div><dt><span className="chart-swatch requests"/>Заявки за период</dt><dd>{number.format(requests)}</dd></div></dl>
    <p className="daily-chart-note">Посещения учитываются только после согласия на аналитику. Это не полное число посетителей. Заявки — все сохранённые рабочие заявки, независимо от согласия.</p>
    {data.knownVisitDays<data.period&&<p className="daily-chart-retention">История посещений старше срока хранения недоступна: серые отметки — отсутствие сохранённых данных, а не ноль. Заявки показаны за все {data.period} дней.</p>}
    <div className="daily-chart-legend" aria-label="Легенда"><span><i className="chart-swatch visits"/>Посещения</span><span><i className="chart-swatch requests"/>Заявки</span>{data.knownVisitDays<data.period&&<span><i className="chart-swatch unknown"/>Нет сохранённых данных</span>}</div>
    <div className="daily-chart-stage">
      <div className="daily-chart-scroll" ref={wrap} tabIndex={0} role="region" aria-label="График по дням; при необходимости прокрутите по горизонтали" onKeyDown={e=>{if(e.key==="Escape"){setActive(null);setPinned(false);}}}>
        <svg width={width} height={314} viewBox={`0 0 ${width} 314`} className="daily-chart-svg" aria-label="Посещения и заявки: выберите день для точных значений">
          <text x={left} y={18} className="chart-axis-title">Количество</text>
          {scale.ticks.map(tick=><g key={tick}><line x1={left} x2={width-right} y1={y(tick)} y2={y(tick)} className="chart-grid"/><text x={left-10} y={y(tick)+4} textAnchor="end" className="chart-axis-label">{tick>=10000?shortNumber.format(tick):number.format(tick)}</text></g>)}
          <line x1={left} x2={left} y1={top} y2={bottom} className="chart-axis"/><line x1={left} x2={width-right} y1={bottom} y2={bottom} className="chart-axis"/>
          {data.points.map((point,i)=>{
            const center=left+cell*(i+.5),visitX=center-bar-2,requestX=center+2;
            const label=`${fullDate(point.day)}. Посещения: ${point.visits===null?"нет сохранённых данных":number.format(point.visits)}. Заявки: ${number.format(point.requests)}.`;
            return <g key={point.day} className={`chart-day${active===i?" selected":""}`} role="button" tabIndex={0} aria-label={label}
              onPointerEnter={e=>{if(e.pointerType==="mouse"&&!pinned)show(i,e.currentTarget);}}
              onPointerLeave={()=>{if(!pinned)setActive(null);}}
              onFocus={e=>{if(!pinned)show(i,e.currentTarget);}} onBlur={()=>{if(!pinned)setActive(null);}}
              onClick={e=>{if(pinned&&active===i){setActive(null);setPinned(false);}else{show(i,e.currentTarget);setPinned(true);}}}
              onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();show(i,e.currentTarget);setPinned(true);}if(e.key==="Escape"){setActive(null);setPinned(false);}}}>
              <title>{label}</title>
              <rect x={left+cell*i+1} y={top} width={Math.max(1,cell-2)} height={bottom-top} className="chart-day-hit"/>
              {point.visits===null?<line x1={visitX} x2={visitX+bar} y1={bottom-3} y2={bottom-3} className="chart-unknown"/>:point.visits>0?<rect x={visitX} y={y(point.visits)} width={bar} height={bottom-y(point.visits)} rx={Math.min(3,bar/2)} className="chart-bar-visits"/>:<circle cx={visitX+bar/2} cy={bottom-2} r={1.5} className="chart-zero-visits"/>}
              {point.requests>0?<rect x={requestX} y={y(point.requests)} width={bar} height={bottom-y(point.requests)} rx={Math.min(3,bar/2)} className="chart-bar-requests"/>:<circle cx={requestX+bar/2} cy={bottom-2} r={1.5} className="chart-zero-requests"/>}
              {(data.period===7||i%Math.ceil(data.period/7)===0||i===data.points.length-1)&&<text x={center} y={bottom+24} textAnchor="middle" className="chart-axis-label">{shortDate(point.day)}</text>}
            </g>;
          })}
          <text x={left+plotWidth/2} y={304} textAnchor="middle" className="chart-axis-title">Дата · UTC</text>
        </svg>
      </div>
      {selected&&<div className="daily-chart-tooltip" style={{left:tipX}} role="status"><strong>{fullDate(selected.day)}</strong><span>Посещения: {selected.visits===null?"нет сохранённых данных":number.format(selected.visits)}</span><span>Заявки: {number.format(selected.requests)}</span><small>{pinned?"Нажмите день повторно или Esc, чтобы закрыть":"Нажмите, чтобы закрепить"}</small></div>}
    </div>
    <p className="daily-chart-help">Наведите курсор или нажмите на день, чтобы увидеть точные значения.{data.period>7?" На небольшом экране график прокручивается горизонтально.":""} Точки у оси означают ноль.</p>
    {visits===0&&requests===0&&<p className="analytics-empty">За выбранный период нет сохранённых посещений со согласием или заявок. Нулевые дни показаны на графике.</p>}
    <details className="daily-chart-table"><summary>Все значения по дням</summary><div className="crm-table-wrap"><table><thead><tr><th>Дата (UTC)</th><th>Посещения</th><th>Заявки</th></tr></thead><tbody>{data.points.map(p=><tr key={p.day}><td>{fullDate(p.day)}</td><td>{p.visits===null?"Нет сохранённых данных":number.format(p.visits)}</td><td>{number.format(p.requests)}</td></tr>)}</tbody></table></div></details>
  </section>;
}
