'use strict';
window.VideoGraphs = (() => {
  const NS = 'http://www.w3.org/2000/svg', $ = id => document.getElementById(id);
  const colors = ['#85e0cb','#ffbe76','#82b9ff','#ed9bdb','#c5d875','#c5a7ff','#ff8c8c','#8ed1ed'];
  const judoLabels = {white_ippon:'white 一本',blue_ippon:'blue 一本',
    white_wazaari:'white 技あり',blue_wazaari:'blue 技あり',white_shido:'white 指導',blue_shido:'blue 指導'};
  let model, data, api, metrics = [], selected = new Set(), domain = [0,1], fullDomain = [0,1];
  let views = [], currentTime = 0, currentRows = new Set(), plotRanges = [];
  function svg(tag, attrs = {}, text) {
    const element = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function metricValue(row, key) {
    const value = row[key];
    if (['1st','2nd','3rd','runner_on_first','runner_on_second','runner_on_third'].includes(key)) {
      if (/^true$/i.test(value)) return 1;
      if (/^false$/i.test(value)) return 0;
    }
    return window.ViewerCore.number(value);
  }
  function kind(key) {
    const judo = key.match(/^(white|blue)_(ippon|wazaari|shido)$/);
    if (judo) return 'judo_' + judo[2];
    if (/rate|probability/.test(key)) return 'rate';
    if (/score$/.test(key)) return 'score';
    if (/_points$/.test(key)) return 'points';
    if (/gold$/.test(key)) return 'gold';
    return key;
  }
  function discover() {
    return model.columns.filter(key =>
      !/(^|_)(id|time|sec|start|end|frames)(_|$)/i.test(key) && !['source_lines','__extra_columns'].includes(key) &&
      model.rows.some(row => metricValue(row, key) !== null)
    ).map(key => ({key, label: api.labels[key] || judoLabels[key] || key, kind: kind(key)}));
  }
  function validItems() { return model.items.filter(item => item.to > item.from || item.inclusive); }
  function inningRanges(items) {
    if (!model.columns.includes('inning')) return [];
    const whole = new Map(), halves = new Map();
    function include(map, key, label, item) {
      if (!map.has(key)) map.set(key, {label,from:item.from,to:item.from});
      const range = map.get(key);
      range.from = Math.min(range.from,item.from); range.to = Math.max(range.to,item.from);
    }
    for (const item of items) {
      const row = model.rows[item.rowIndex], inning = window.ViewerCore.number(row.inning);
      if (!Number.isInteger(inning) || inning < 1) continue;
      const game = row.game_id || '', prefix = game ? `game ${game} / ` : '';
      include(whole,JSON.stringify([game,inning]),`${prefix}${inning}回（全体）`,item);
      const half = String(row.inning_half || '').trim().toLowerCase();
      const halfLabel = {top:'表',bottom:'裏','表':'表','裏':'裏'}[half];
      if (halfLabel) include(halves,JSON.stringify([game,inning,halfLabel]),`${prefix}${inning}回${halfLabel}`,item);
    }
    return [...whole.values()].map(range=>({...range,group:'イニング全体'}))
      .concat([...halves.values()].map(range=>({...range,group:'イニングの表・裏'})));
  }
  function install(incomingModel, incomingData, incomingAPI) {
    model = incomingModel; data = incomingData; api = incomingAPI;
    metrics = discover();
    const preferred = metrics.filter(metric => ['score','rate','points','gold','squads_left','chips_bb','round_number','honba'].includes(metric.kind));
    selected = new Set((preferred.length ? preferred : metrics).map(metric => metric.key));
    if (!metrics.length && model.rows.length) {
      metrics = [{key:'__events', label:'イベント・区間', kind:'events'}]; selected.add('__events');
    }
    const items = validItems();
    fullDomain = items.length ? [Math.min(...items.map(item => item.from)), Math.max(...items.map(item => item.to))] : [0,1];
    if (fullDomain[1] <= fullDomain[0]) fullDomain[1] = fullDomain[0] + 1;
    domain = fullDomain.slice();
    $('plot-metrics').replaceChildren();
    const legend = document.createElement('legend'); legend.textContent = '表示する項目'; $('plot-metrics').append(legend);
    metrics.forEach(metric => {
      const label = document.createElement('label'), checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.checked = selected.has(metric.key); checkbox.value = metric.key;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(metric.key); else selected.delete(metric.key);
        draw();
      });
      label.append(checkbox, document.createTextNode(metric.label)); $('plot-metrics').append(label);
    });
    $('plot-range').replaceChildren();
    const all = document.createElement('option'); all.value = 'all'; all.textContent = '全体'; $('plot-range').append(all);
    plotRanges = [...model.ranges, ...inningRanges(items)];
    const optionGroups = new Map();
    plotRanges.forEach((range, index) => {
      const option = document.createElement('option'); option.value = String(index);
      option.textContent = `${range.label} (${api.clock(range.from)}〜${api.clock(range.to)})`;
      if (range.group) {
        if (!optionGroups.has(range.group)) {
          const group = document.createElement('optgroup'); group.label = range.group;
          optionGroups.set(range.group,group); $('plot-range').append(group);
        }
        optionGroups.get(range.group).append(option);
      } else $('plot-range').append(option);
    });
    $('plot-readout').textContent = '点にカーソルを合わせると時刻と値を確認できます。';
    syncInputs(); draw();
  }
  function syncInputs() {
    $('plot-start').value = domain[0].toFixed(3); $('plot-end').value = domain[1].toFixed(3);
  }
  function setDomain(start, end) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      $('plot-readout').textContent = '表示範囲は、0以上の開始時刻と、それより大きい終了時刻を指定してください。'; return;
    }
    domain = [start,end]; syncInputs(); draw();
  }
  function buildSeries(group) {
    const series = new Map();
    for (const metric of group) {
      for (const item of validItems()) {
        const row = model.rows[item.rowIndex], player = row.name || '';
        const key = JSON.stringify([metric.key,player]);
        if (!series.has(key)) series.set(key, {key, metric, label: metric.label + (player ? ` · ${player}` : ''), points:[]});
        series.get(key).points.push({x:item.from, y:metric.key === '__events' ? 1 : metricValue(row,metric.key),
          rowIndex:item.rowIndex, to:item.to, partition:item.label, item, row});
      }
    }
    for (const value of series.values()) value.points.sort((a,b) => a.x - b.x || a.rowIndex - b.rowIndex);
    return [...series.values()];
  }
  function draw() {
    $('plot-panels').replaceChildren(); views = [];
    const groups = new Map();
    for (const metric of metrics.filter(metric => selected.has(metric.key))) {
      if (!groups.has(metric.kind)) groups.set(metric.kind, []);
      groups.get(metric.kind).push(metric);
    }
    if (!groups.size) {
      const message = document.createElement('p');
      message.textContent = model.rows.length ? '表示する項目を選択してください。' : 'CSVを読み込むとグラフが表示されます。';
      $('plot-panels').append(message); return;
    }
    const names = {score:'スコア推移',rate:'勝率・投票率 (%)',points:'点数推移',gold:'ゴールド推移',events:'イベント・区間',
      judo_ippon:'一本',judo_wazaari:'技あり',judo_shido:'指導',round_number:'局の推移',honba:'本場の推移'};
    for (const [groupKind, group] of groups) {
      drawPanel(names[groupKind] || group[0].label, groupKind, buildSeries(group));
    }
    update(currentTime, [...currentRows].map(rowIndex => ({rowIndex})));
  }
  function valueAxis(values, integerOnly) {
    let min = values.length ? Math.min(...values) : 0;
    let max = values.length ? Math.max(...values) : 1;
    if (min === max) {
      const pad = integerOnly ? 1 : min === 0 ? 1 : 10 ** Math.floor(Math.log10(Math.abs(min))) / 10;
      min = min >= 0 ? Math.max(0, min - pad) : min - pad;
      max += pad;
    }
    const target = (max - min) / 5;
    const magnitude = 10 ** Math.floor(Math.log10(target));
    const fraction = target / magnitude;
    let step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
    if (integerOnly) step = Math.max(1, step);
    // Round bounds to the tick step, instead of adding fractional padding.
    const first = Math.floor(Number((min / step).toPrecision(12)));
    const last = Math.ceil(Number((max / step).toPrecision(12)));
    const clean = value => Number(value.toPrecision(12));
    return {min:clean(first * step), max:clean(last * step),
      ticks:Array.from({length:last-first+1}, (_,i) => clean((first+i)*step))};
  }
  function drawPanel(title, groupKind, series) {
    const panel = document.createElement('section'); panel.className = 'plot-panel';
    const heading = document.createElement('h3'); heading.textContent = title; panel.append(heading);
    const legend = document.createElement('div'); legend.className = 'plot-legend';
    const width = 1000, height = 320, left = 76, right = 24, top = 20, bottom = 48;
    const plotWidth = width-left-right, plotHeight = height-top-bottom;
    const x = time => left + (time-domain[0])/(domain[1]-domain[0])*plotWidth;
    const visible = series.flatMap(s => s.points.filter(p => p.y !== null && p.x <= domain[1] && p.to >= domain[0]));
    const integerOnly = series.every(s => s.points.every(p => p.y === null || Number.isInteger(p.y)));
    const axis = groupKind === 'events' ? {min:0,max:2,ticks:[0,1,2]} : valueAxis(visible.map(p => p.y), integerOnly);
    const {min,max} = axis;
    const y = value => top + plotHeight-(value-min)/(max-min)*plotHeight;
    const root = svg('svg', {viewBox:`0 0 ${width} ${height}`, role:'group', 'aria-label':title+'。点を選択すると動画へ移動します。'});
    root.append(svg('rect',{x:left,y:top,width:plotWidth,height:plotHeight,fill:'#13202c'}));
    for(const value of axis.ticks) {
      root.append(svg('line',{x1:left,x2:width-right,y1:y(value),y2:y(value),stroke:'#304356'}));
      if(groupKind!=='events')root.append(svg('text',{x:left-10,y:y(value)+4,'text-anchor':'end',class:'axis-label y-axis-label','data-value':value},value.toLocaleString(undefined,{maximumFractionDigits:12})));
    }
    for(let i=0;i<=5;i++) {
      const time=domain[0]+(domain[1]-domain[0])*i/5;
      root.append(svg('line',{x1:x(time),x2:x(time),y1:top,y2:top+plotHeight,stroke:'#263848'}));
      root.append(svg('text',{x:x(time),y:height-20,'text-anchor':i===0?'start':i===5?'end':'middle',class:'axis-label'},api.clock(time).replace(/\.\d+$/,'')));
    }
    root.append(svg('text',{x:width/2,y:height-2,'text-anchor':'middle',class:'axis-label'},'CSV参照時刻 (分:秒)'));
    const pointLayer = svg('g'); const circles = [];
    series.forEach((s, seriesIndex) => {
      const color=/^white_/.test(s.metric.key)?'#edf5fc':/^blue_/.test(s.metric.key)?'#82b9ff':colors[seriesIndex%colors.length], key=document.createElement('span');
      key.textContent=s.label; key.style.setProperty('--series-color',color); legend.append(key);
      let previous=null, path='';
      for(const point of s.points) {
        const numeric=point.y!==null;
        const clippedStart=Math.max(domain[0],point.x),clippedEnd=Math.min(domain[1],point.to);
        const inRange=numeric&&clippedStart<=clippedEnd&&point.x<=domain[1]&&point.to>=domain[0];
        if(!inRange){previous=null;continue;}
        const connected=previous&&previous.partition===point.partition&&previous.to>=point.x&&previous.x<=point.x;
        const isStep=groupKind!=='rate';
        if(isStep) {
          // Draw values only for their actual validity interval, including cropped ranges.
          if(connected&&point.x>=domain[0])path+=` L${x(point.x)},${y(point.y)}`;
          else path+=` M${x(clippedStart)},${y(point.y)}`;
          path+=` L${x(clippedEnd)},${y(point.y)}`;
        } else {
          if(connected&&previous.x>=domain[0]&&point.x<=domain[1])path+=` L${x(point.x)},${y(point.y)}`;
          else if(point.x>=domain[0]&&point.x<=domain[1])path+=` M${x(point.x)},${y(point.y)}`;
        }
        previous=point;
        if(point.x<domain[0]||point.x>domain[1])continue;
        const text=`${s.label}: ${point.y} / ${api.clock(point.x)} / CSV ${point.rowIndex+2}行目`;
        const circle=svg('circle',{cx:x(point.x),cy:y(point.y),r:4,fill:color,stroke:'#13202c','stroke-width':1,
          tabindex:0,role:'button','aria-label':text,class:'plot-point','data-row':point.rowIndex,'data-time':point.x,'data-metric':s.metric.key});
        circle.append(svg('title',{},text));
        const describe=()=>{$('plot-readout').textContent=text;};
        const go=()=>{describe();api.seek(point.x);};
        circle.addEventListener('mouseenter',describe);circle.addEventListener('focus',describe);
        circle.addEventListener('click',go);
        circle.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();go();}});
        pointLayer.append(circle);circles.push({circle,rowIndex:point.rowIndex});
      }
      if(path)root.append(svg('path',{d:path,stroke:color,fill:'none','stroke-width':1.6,'pointer-events':'none',class:'plot-series','data-series':s.key}));
    });
    const cursor=svg('line',{x1:left,x2:left,y1:top,y2:top+plotHeight,stroke:'#fff','stroke-dasharray':'5 4','stroke-width':1.5,'pointer-events':'none',class:'plot-cursor'});
    root.append(cursor,pointLayer);panel.append(legend,root);
    if(!visible.length){const p=document.createElement('p');p.className='hint';p.textContent='この表示範囲に有効な数値はありません。';panel.append(p);}
    $('plot-panels').append(panel);views.push({cursor,x,circles,previousKey:''});
  }
  function update(time, active) {
    currentTime=time; currentRows=new Set(active.map(item=>item.rowIndex));
    const key=[...currentRows].sort((a,b)=>a-b).join(',');
    for(const view of views) {
      const visible=time>=domain[0]&&time<=domain[1];view.cursor.style.display=visible?'':'none';
      if(visible){view.cursor.setAttribute('x1',view.x(time));view.cursor.setAttribute('x2',view.x(time));}
      if(key!==view.previousKey){
        view.previousKey=key;
        for(const point of view.circles)point.circle.classList.toggle('selected',currentRows.has(point.rowIndex));
      }
    }
  }
  $('plot-range').addEventListener('change',()=>{
    const range=$('plot-range').value==='all'?null:plotRanges[Number($('plot-range').value)];
    if(range){setDomain(range.from,range.to>range.from?range.to:range.from+1);}else setDomain(...fullDomain);
  });
  $('plot-apply').addEventListener('click',()=>{ $('plot-range').value='all';setDomain(Number($('plot-start').value),Number($('plot-end').value)); });
  $('plot-reset').addEventListener('click',()=>{ $('plot-range').value='all';setDomain(...fullDomain); });
  return {install,update};
})();
