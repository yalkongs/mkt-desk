import Anthropic from '@anthropic-ai/sdk'
import { fetchRecentNews, newsBlock, geoBlock, bp, chg, setCorsHeaders } from '../_shared.mjs'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).end()

  const apiKey = req.headers['x-api-key']
  if (!apiKey) return res.status(401).json({ error: 'Claude API 키가 필요합니다.' })

  const { snapshot, weekEvents, geoContext } = req.body
  if (!snapshot?.rates || !snapshot?.fx || !snapshot?.overseas) {
    return res.status(400).json({ error: '시장 데이터가 유효하지 않습니다. 페이지를 새로고침 후 다시 시도해주세요.' })
  }
  const { rates, fx, overseas } = snapshot

  const dataContext = `[주간 시장 데이터 — ${snapshot.date} 기준]

■ 주말 금리 (주간 누적 변동 참고)
- 기준금리: ${rates.baseRate}%
- 국고채 3Y: ${rates.ktb3y.value}% (일별 ${bp(rates.ktb3y.change)})
- 국고채 5Y: ${rates.ktb5y.value}% (일별 ${bp(rates.ktb5y.change)})
- 국고채 10Y: ${rates.ktb10y.value}% (일별 ${bp(rates.ktb10y.change)})
- 장단기 스프레드(10Y-3Y): ${Math.round((rates.ktb10y.value - rates.ktb3y.value) * 100)}bp
- CD 91일: ${rates.cd91.value}% / CP 91일: ${rates.cp91.value}%
- IRS 3Y: ${rates.irs3y.value}% / IRS 5Y: ${rates.irs5y.value}%
- 은행채 AAA 3Y: ${rates.bankBond3y.value}% (KTB 스프레드: ${Math.round((rates.bankBond3y.value - rates.ktb3y.value) * 100)}bp)
- 회사채 AA- 3Y: ${rates.corpAAMinus3y.value}% (KTB 스프레드: ${Math.round((rates.corpAAMinus3y.value - rates.ktb3y.value) * 100)}bp)

■ 주말 외환/해외
- USD/KRW: ${fx.usdKrw.value.toFixed(1)}원 (일별 ${chg(fx.usdKrw.change, 1)}원)
- EUR/KRW: ${fx.eurKrw.value.toFixed(1)}원 / DXY: ${fx.dxy.value.toFixed(2)}
- 미 국채 2Y: ${overseas.ust2y.value}% (${bp(overseas.ust2y.change)}) / 10Y: ${overseas.ust10y.value}% (${bp(overseas.ust10y.change)})
- SOFR: ${overseas.sofr.value}%
- KOSPI: ${overseas.kospi.value.toLocaleString()} / S&P500: ${overseas.sp500.value.toLocaleString()}
- VIX: ${overseas.vix.value.toFixed(1)} / WTI: $${overseas.wti.value.toFixed(1)} / 금: $${overseas.gold.value.toLocaleString()}
- 한국 CDS 5Y: ${overseas.koreaCds5y.value.toFixed(1)}bp
${geoBlock(geoContext)}
■ 차주 주요 일정
${(weekEvents || []).filter(e => !e.actual).map(e =>
  `- ${e.time} [${e.country}] ${e.event} (이전: ${e.previous}, 예상: ${e.forecast})`
).join('\n')}`

  const news = await fetchRecentNews()
  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1400,
      system: `당신은 국내 시중은행 자금시장부의 시니어 채권·외환 애널리스트입니다. 매주 금요일 임원 및 딜러들에게 배포하는 '주간 마켓리뷰'의 총평을 작성합니다.

작성 원칙:
- 주간 흐름을 관통한 핵심 테마와 드라이버를 중심으로 서술 (단순 수치 나열 금지)
- 해외(미국·유럽·일본) → 국내 채권 → 외환/크레딧 → 차주 전망·리스크 순서
- 정치·지정학 이슈가 있으면 시장 영향과 함께 반드시 포함
- 커브 형태 변화(스티프닝/플래트닝), 스프레드 동향 등 구체적 시장 구조 언급
- 차주 핵심 이벤트별 시나리오(예상치 상회/하회 시 시장 반응) 제시
- 3~4개 단락, 총 450~550자, 마크다운 없이 순수 텍스트, 단락 사이 빈 줄 하나`,
      messages: [{
        role: 'user',
        content: `다음 데이터를 바탕으로 이번 주(${snapshot.date} 기준) 주간 마켓리뷰의 '주간 총평' 섹션을 작성해주세요.\n\n${dataContext}${newsBlock(news)}`,
      }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    res.json({ narrative: text })
  } catch (err) {
    console.error('[narrative/weekly]', err.message)
    res.status(500).json({ error: err.message || '주간 내러티브 생성에 실패했습니다.' })
  }
}
