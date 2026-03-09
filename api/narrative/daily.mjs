import Anthropic from '@anthropic-ai/sdk'
import { fetchRecentNews, newsBlock, bp, chg, setCorsHeaders } from '../_shared.mjs'

function buildDataContext(snapshot, events) {
  const { rates, fx, overseas } = snapshot
  const spread10y3y = Math.round((rates.ktb10y.value - rates.ktb3y.value) * 100)
  const spreadBank  = Math.round((rates.bankBond3y.value - rates.ktb3y.value) * 100)
  const spreadCorp  = Math.round((rates.corpAAMinus3y.value - rates.ktb3y.value) * 100)
  const ust2s10s    = Math.round((overseas.ust10y.value - overseas.ust2y.value) * 100)

  return `[시장 데이터 — ${snapshot.date}]

■ 국내 금리 (전일 대비)
- 기준금리: ${rates.baseRate}%
- 콜금리: ${rates.call.value}% (${bp(rates.call.change)})
- CD 91일: ${rates.cd91.value}% (${bp(rates.cd91.change)})
- CP 91일(A1): ${rates.cp91.value}% (${bp(rates.cp91.change)})
- 국고채 1Y: ${rates.ktb1y.value}% (${bp(rates.ktb1y.change)})
- 국고채 3Y: ${rates.ktb3y.value}% (${bp(rates.ktb3y.change)})
- 국고채 5Y: ${rates.ktb5y.value}% (${bp(rates.ktb5y.change)})
- 국고채 10Y: ${rates.ktb10y.value}% (${bp(rates.ktb10y.change)})
- 국고채 30Y: ${rates.ktb30y.value}% (${bp(rates.ktb30y.change)})
- 장단기 스프레드(10Y-3Y): ${spread10y3y}bp
- IRS 3Y: ${rates.irs3y.value}% (${bp(rates.irs3y.change)})
- IRS 5Y: ${rates.irs5y.value}% (${bp(rates.irs5y.change)})
- 은행채 AAA 3Y: ${rates.bankBond3y.value}% (${bp(rates.bankBond3y.change)}) / KTB 스프레드: ${spreadBank}bp
- 회사채 AA- 3Y: ${rates.corpAAMinus3y.value}% (${bp(rates.corpAAMinus3y.change)}) / KTB 스프레드: ${spreadCorp}bp

■ 외환
- USD/KRW: ${fx.usdKrw.value.toFixed(1)}원 (${chg(fx.usdKrw.change, 1)}원)
- EUR/KRW: ${fx.eurKrw.value.toFixed(1)}원 (${chg(fx.eurKrw.change, 1)}원)
- JPY/KRW(100): ${(fx.jpyKrw.value * 100).toFixed(2)}원 (${chg(fx.jpyKrw.change * 100, 2)}원)
- DXY: ${fx.dxy.value.toFixed(2)} (${chg(fx.dxy.change, 2)})
- NDF 1M: ${fx.ndf1m.value.toFixed(1)}원

■ 해외 시장
- 미 국채 2Y: ${overseas.ust2y.value}% (${bp(overseas.ust2y.change)})
- 미 국채 10Y: ${overseas.ust10y.value}% (${bp(overseas.ust10y.change)})
- 미 국채 30Y: ${overseas.ust30y.value}% (${bp(overseas.ust30y.change)})
- 미 국채 2s10s 스프레드: ${ust2s10s}bp
- SOFR: ${overseas.sofr.value}%
- S&P500: ${overseas.sp500.value.toLocaleString()} (${chg(overseas.sp500.change, 2)}%)
- KOSPI: ${overseas.kospi.value.toLocaleString()} (${chg(overseas.kospi.change, 2)}%)
- VIX: ${overseas.vix.value.toFixed(1)} / WTI: $${overseas.wti.value.toFixed(1)} / 금: $${overseas.gold.value.toLocaleString()}
- 한국 CDS 5Y: ${overseas.koreaCds5y.value.toFixed(1)}bp

■ 금일 주요 일정
${(events || []).map(e =>
  `- ${e.time} [${e.country}] ${e.event} (이전: ${e.previous}, 예상: ${e.forecast}${e.actual ? `, 실제: ${e.actual}` : ''})`
).join('\n')}`
}

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).end()

  const apiKey = req.headers['x-api-key']
  if (!apiKey) return res.status(401).json({ error: 'Claude API 키가 필요합니다.' })

  const { snapshot, events } = req.body
  if (!snapshot?.rates || !snapshot?.fx || !snapshot?.overseas) {
    return res.status(400).json({ error: '시장 데이터가 유효하지 않습니다. 페이지를 새로고침 후 다시 시도해주세요.' })
  }
  const dataContext = buildDataContext(snapshot, events)
  const news = await fetchRecentNews()

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: `당신은 국내 시중은행 자금시장부의 시니어 채권·외환 애널리스트입니다. 매일 아침 임원 및 딜러들에게 배포하는 '자금시장 모닝브리프'의 마켓 총평을 작성합니다.

작성 원칙:
- 해외 채권시장 → 달러/외환 → 국내 채권시장 → 금일 주요 이슈 순서로 서술
- 단순 수치 나열이 아닌, 데이터 간 인과관계와 시장에 미치는 영향을 해석하여 서술
- 전문적이고 간결한 금융 용어 사용 (bp, 스프레드, 커브 스티프닝/플래트닝, 베어/불 등)
- 불확실성과 리스크 요인을 명시하고 금일 주목해야 할 레인지 또는 포인트를 제시
- 뉴스 헤드라인이 제공된 경우 시장에 영향을 주는 주요 이슈를 총평에 반영할 것
- 4개 단락 구성, 각 단락 3~4문장, 총 400~500자 수준
- 마크다운 기호(**, ##, - 등) 없이 순수 텍스트로만 출력
- 각 단락 사이에 빈 줄 하나 삽입`,
      messages: [{
        role: 'user',
        content: `다음 시장 데이터를 바탕으로 오늘(${snapshot.date}) 자금시장 모닝브리프의 '마켓 총평' 섹션을 작성해주세요.\n\n${dataContext}${newsBlock(news)}`,
      }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    res.json({ narrative: text })
  } catch (err) {
    console.error('[narrative/daily]', err.message)
    res.status(500).json({ error: err.message || '내러티브 생성에 실패했습니다.' })
  }
}
