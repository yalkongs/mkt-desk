import Anthropic from '@anthropic-ai/sdk'
import { fetchRecentNews, newsBlock, geoBlock, bp, setCorsHeaders } from '../_shared.mjs'

const ADHOC_SYSTEM = {
  fomc: `당신은 연준(Fed) 정책 전문 채권 애널리스트입니다. FOMC 결과를 즉각 분석하여 국내 금융시장에 미치는 영향을 긴급 브리핑 형태로 작성합니다.
구성: ① FOMC 결과 요약 ② 시장 즉각 반응 (미 국채·달러·주가) ③ 국내 채권·외환 영향 분석 ④ 당행 포지션 시사점 ⑤ 다음 모니터링 포인트`,
  boc: `당신은 한국은행 통화정책 전문 애널리스트입니다. 금통위를 앞두고 결정 시나리오별 시장 영향을 분석하는 프리뷰 브리핑을 작성합니다.
구성: ① 동결/인하 시나리오 확률 및 근거 ② 시나리오별 시장 반응 전망 ③ 총재 기자회견 주목 포인트 ④ 당행 포지션 시사점`,
  shock: `당신은 시장 긴급 상황 분석 전문 애널리스트입니다. 시장 급변동 발생 시 원인과 파급 경로를 신속·정확하게 분석하는 긴급 코멘터리를 작성합니다.
구성: ① 급변동 원인 및 트리거 ② 국내외 시장 즉각 반응 ③ 파급 경로 및 리스크 ④ 당행 포지션 점검 사항 ⑤ 향후 안정화 조건`,
  rate: `당신은 채권시장 전문 애널리스트입니다. 금리 급등 사태 발생 시 원인 분석 및 방향성 전망 브리핑을 작성합니다.
구성: ① 금리 급등 배경 및 트리거 ② 커브 형태 변화 분석 ③ 외국인·기관 수급 동향 ④ 당행 듀레이션·포지션 시사점 ⑤ 단기 레인지 및 반전 조건`,
}

export default async function handler(req, res) {
  setCorsHeaders(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).end()

  const apiKey = req.headers['x-api-key']
  if (!apiKey) return res.status(401).json({ error: 'Claude API 키가 필요합니다.' })

  const { snapshot, templateType, topicDesc, geoContext } = req.body
  if (!snapshot?.rates || !snapshot?.fx || !snapshot?.overseas) {
    return res.status(400).json({ error: '시장 데이터가 유효하지 않습니다. 페이지를 새로고침 후 다시 시도해주세요.' })
  }
  const { rates, fx, overseas } = snapshot

  const dataContext = `[현재 시장 데이터 — ${snapshot.date}]
- 국고채 3Y: ${rates.ktb3y.value}% (${bp(rates.ktb3y.change)}) / 10Y: ${rates.ktb10y.value}% (${bp(rates.ktb10y.change)})
- IRS 3Y: ${rates.irs3y.value}% / 장단기 스프레드: ${Math.round((rates.ktb10y.value - rates.ktb3y.value) * 100)}bp
- USD/KRW: ${fx.usdKrw.value.toFixed(1)}원 / DXY: ${fx.dxy.value.toFixed(2)}
- 미 국채 2Y: ${overseas.ust2y.value}% / 10Y: ${overseas.ust10y.value}%
- KOSPI: ${overseas.kospi.value.toLocaleString()} / VIX: ${overseas.vix.value.toFixed(1)}
- 회사채 AA- 3Y: ${rates.corpAAMinus3y.value}% / 한국 CDS 5Y: ${overseas.koreaCds5y.value.toFixed(1)}bp
${geoBlock(geoContext)}`

  const systemPrompt = ADHOC_SYSTEM[templateType] || ADHOC_SYSTEM.shock
  const news = await fetchRecentNews()
  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1400,
      system: systemPrompt + '\n\n공통 원칙: 정치·지정학 이슈가 있으면 시장 영향과 함께 반드시 분석. 마크다운 없이 순수 텍스트. 섹션 제목은 【】로 표시. 총 600~800자.',
      messages: [{
        role: 'user',
        content: `브리핑 주제: ${topicDesc || '시장 긴급 분석'}\n\n${dataContext}${newsBlock(news)}\n위 상황에 대한 긴급 브리핑 초안을 작성해주세요.`,
      }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    res.json({ narrative: text })
  } catch (err) {
    console.error('[narrative/adhoc]', err.message)
    res.status(500).json({ error: err.message || '수시 브리핑 생성에 실패했습니다.' })
  }
}
