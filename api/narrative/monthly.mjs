import Anthropic from '@anthropic-ai/sdk'
import { fetchRecentNews, newsBlock, geoBlock, setCorsHeaders } from '../_shared.mjs'

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).end()

  const apiKey = req.headers['x-api-key']
  if (!apiKey) return res.status(401).json({ error: 'Claude API 키가 필요합니다.' })

  const { snapshot, targetMonth, geoContext } = req.body
  if (!snapshot?.rates || !snapshot?.fx || !snapshot?.overseas) {
    return res.status(400).json({ error: '시장 데이터가 유효하지 않습니다. 페이지를 새로고침 후 다시 시도해주세요.' })
  }
  const { rates, fx, overseas } = snapshot

  const dataContext = `[월간 시장 데이터 — ${targetMonth || snapshot.date} 기준]

■ 주요 금리 (월말 기준)
- 기준금리: ${rates.baseRate}%
- 국고채 3Y: ${rates.ktb3y.value}% / 5Y: ${rates.ktb5y.value}% / 10Y: ${rates.ktb10y.value}%
- 장단기 스프레드(10Y-3Y): ${Math.round((rates.ktb10y.value - rates.ktb3y.value) * 100)}bp
- IRS 3Y: ${rates.irs3y.value}% / IRS 5Y: ${rates.irs5y.value}%
- 은행채 AAA 3Y: ${rates.bankBond3y.value}% (스프레드: ${Math.round((rates.bankBond3y.value - rates.ktb3y.value) * 100)}bp)
- 회사채 AA- 3Y: ${rates.corpAAMinus3y.value}% (스프레드: ${Math.round((rates.corpAAMinus3y.value - rates.ktb3y.value) * 100)}bp)
- 회사채 BBB- 3Y: ${rates.corpBBBMinus3y.value}%

■ 외환/해외 (월말 기준)
- USD/KRW: ${fx.usdKrw.value.toFixed(1)}원 / EUR/KRW: ${fx.eurKrw.value.toFixed(1)}원
- DXY: ${fx.dxy.value.toFixed(2)} / NDF 1M: ${fx.ndf1m.value.toFixed(1)}원
- 미 국채 2Y: ${overseas.ust2y.value}% / 10Y: ${overseas.ust10y.value}% / 30Y: ${overseas.ust30y.value}%
- SOFR: ${overseas.sofr.value}%
- KOSPI: ${overseas.kospi.value.toLocaleString()} / S&P500: ${overseas.sp500.value.toLocaleString()}
- VIX: ${overseas.vix.value.toFixed(1)} / WTI: $${overseas.wti.value.toFixed(1)} / 금: $${overseas.gold.value.toLocaleString()}
- 한국 CDS 5Y: ${overseas.koreaCds5y.value.toFixed(1)}bp
${geoBlock(geoContext)}`

  const news = await fetchRecentNews()
  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1600,
      system: `당신은 국내 시중은행 자금시장부의 수석 애널리스트입니다. 매월 이사회 및 임원진에게 배포하는 '월간 마켓리포트'의 핵심 서술 섹션을 작성합니다.

작성 원칙:
- 해당 월의 시장을 관통한 핵심 매크로 테마와 드라이버 중심 분석
- 국내 채권시장 → 외환시장 → 크레딧시장 → 글로벌 중앙은행 정책 순서
- 정치·지정학 이슈가 포함된 경우 시장 가격에 미친 영향 구체적 분석
- 섹션 마지막에 차월 전망 및 시사점 포함 (금리·환율 레인지 포함)
- 당행 자금운용 관점의 시사점(듀레이션, 크레딧 포지션, 헤지 전략 등) 포함
- 4~5개 단락, 총 550~700자, 마크다운 없이 순수 텍스트, 단락 사이 빈 줄`,
      messages: [{
        role: 'user',
        content: `다음 데이터를 바탕으로 ${targetMonth || snapshot.date} 기준 월간 마켓리포트의 '이달의 마켓 총평 & 차월 전망' 섹션을 작성해주세요.\n\n${dataContext}${newsBlock(news)}`,
      }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    res.json({ narrative: text })
  } catch (err) {
    console.error('[narrative/monthly]', err.message)
    res.status(500).json({ error: err.message || '월간 내러티브 생성에 실패했습니다.' })
  }
}
