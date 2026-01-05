/**
 * 배포대장 문서 관리 서비스
 * 배포대장 문서 생성 및 관리 로직
 */

import axios from 'axios';
import https from 'https';

const CONFLUENCE_BASE_URL = 'https://hmg.atlassian.net/wiki';
const SPACE_KEY = 'SPC2';
const ROOT_PARENT_PAGE_ID = '167518624'; // Dev) 배포 관리

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

export type DeploymentType = 'release' | 'adhoc' | 'hotfix';
export type ProjectKey = 'groupware' | 'hmg-board' | 'cpo';

/**
 * JQL labels 조건을 변환
 * 1. 빈 labels 채우기: labels = "" → labels = "타입_날짜"
 * 2. 3가지 타입 치환: hotfix or adhoc or release → 선택한 타입에 맞게
 */
function transformLabelsInJql(
  jqlQuery: string,
  deploymentType: DeploymentType,
  newDate: string
): string {
  let result = jqlQuery;

  // 1. 빈 labels 채우기 (기획 섹션: labels = "" and labels = "기획")
  if (deploymentType === 'release') {
    result = result.replace(
      /labels = &quot;&quot;/g,
      `labels = &quot;release_${newDate}&quot;`
    );
  } else {
    result = result.replace(
      /labels = &quot;&quot;/g,
      `(labels = &quot;hotfix_${newDate}&quot; or labels = &quot;adhoc_${newDate}&quot;)`
    );
  }

  // 2. 3가지 타입 OR 조건 치환
  if (deploymentType === 'release') {
    result = result.replace(
      /labels = &quot;hotfix_\d{6}&quot; or labels = &quot;adhoc_\d{6}&quot; or labels = &quot;release_\d{6}&quot;/g,
      `labels = &quot;release_${newDate}&quot;`
    );
  } else {
    result = result.replace(
      /labels = &quot;hotfix_\d{6}&quot; or labels = &quot;adhoc_\d{6}&quot; or labels = &quot;release_\d{6}&quot;/g,
      `labels = &quot;hotfix_${newDate}&quot; or labels = &quot;adhoc_${newDate}&quot;`
    );
  }

  return result;
}

export interface CreateDeploymentDocumentRequest {
  project: ProjectKey;
  deploymentType: DeploymentType;
  /** YYYY-MM-DD 형식 */
  date: string;
}

export interface CreateDeploymentDocumentResponse {
  success: boolean;
  pageId?: string;
  pageUrl?: string;
  error?: string;
  warning?: string;
  /** 중복 페이지가 있는 경우 */
  existingPageUrl?: string;
}

/**
 * 월별 상위 폴더 ID 찾기
 * 예: 2026-01-03 -> "2601" -> "Dev) 배포 관리 - 2601" 페이지 찾기
 */
async function findMonthlyParentPage(
  yearMonth: string,
  email: string,
  token: string
): Promise<{ id: string; title: string } | null> {
  try {
    // ROOT_PARENT_PAGE_ID 하위 페이지 조회
    const response = await axios.get(
      `${CONFLUENCE_BASE_URL}/rest/api/content/${ROOT_PARENT_PAGE_ID}/child/page`,
      {
        params: {
          limit: 200,
        },
        auth: {
          username: email,
          password: token,
        },
        headers: {
          Accept: 'application/json',
        },
        httpsAgent,
      }
    );

    const children = response.data.results as Array<{
      id: string;
      title: string;
      _links?: { webui?: string };
    }>;
    const targetTitle = `Dev) 배포 관리 - ${yearMonth}`;

    // 제목으로 찾기
    const found = children.find((page) => page.title === targetTitle);

    if (found) {
      return { id: found.id, title: found.title };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 월별 상위 폴더 생성
 */
async function createMonthlyParentPage(
  yearMonth: string,
  email: string,
  token: string
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const title = `Dev) 배포 관리 - ${yearMonth}`;

    const response = await axios.post(
      `${CONFLUENCE_BASE_URL}/rest/api/content`,
      {
        type: 'page',
        title: title,
        space: {
          key: SPACE_KEY,
        },
        ancestors: [
          {
            id: ROOT_PARENT_PAGE_ID,
          },
        ],
        body: {
          storage: {
            value: `<p>이 페이지는 ${yearMonth.slice(0, 2)}년 ${yearMonth.slice(2)}월 배포 관리 문서를 모아두는 폴더입니다.</p>`,
            representation: 'storage',
          },
        },
      },
      {
        auth: {
          username: email,
          password: token,
        },
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        httpsAgent,
      }
    );

    return {
      success: true,
      id: response.data.id,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
      };
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 중복 페이지 확인
 */
async function checkDuplicatePage(
  parentPageId: string,
  title: string,
  email: string,
  token: string
): Promise<{ exists: boolean; pageUrl?: string }> {
  try {
    const response = await axios.get(
      `${CONFLUENCE_BASE_URL}/rest/api/content/${parentPageId}/child/page`,
      {
        params: {
          limit: 200,
        },
        auth: {
          username: email,
          password: token,
        },
        headers: {
          Accept: 'application/json',
        },
        httpsAgent,
      }
    );

    const children = response.data.results as Array<{
      id: string;
      title: string;
      _links?: { webui?: string };
    }>;
    const found = children.find((page) => page.title === title);

    if (found) {
      const pageUrl = `${CONFLUENCE_BASE_URL}${found._links?.webui || ''}`;
      return { exists: true, pageUrl };
    }

    return { exists: false };
  } catch {
    return { exists: false };
  }
}

/**
 * 배포대장 문서 생성
 */
export async function createDeploymentDocument(
  request: CreateDeploymentDocumentRequest
): Promise<CreateDeploymentDocumentResponse> {
  const email = process.env.HMG_JIRA_EMAIL;
  const token = process.env.HMG_JIRA_API_TOKEN;

  if (!email || !token) {
    return {
      success: false,
      error: 'Confluence 인증 정보가 설정되지 않았습니다.',
    };
  }

  try {
    const { deploymentType, date } = request;

    // 날짜 파싱 (YYYY-MM-DD -> YYMMDD)
    const dateParts = date.split('-');
    const year = dateParts[0].slice(2); // 2025 -> 25
    const month = dateParts[1]; // 01
    const day = dateParts[2]; // 03
    const shortDate = `${year}${month}${day}`; // 251203
    const yearMonth = `${year}${month}`; // 2512

    // 1. 월별 상위 폴더 찾기
    let parentPage = await findMonthlyParentPage(yearMonth, email, token);

    // 상위 폴더가 없으면 생성
    if (!parentPage) {
      const createResult = await createMonthlyParentPage(
        yearMonth,
        email,
        token
      );

      if (!createResult.success || !createResult.id) {
        return {
          success: false,
          error: `월별 상위 폴더 생성 실패: ${createResult.error}`,
        };
      }

      parentPage = {
        id: createResult.id,
        title: `Dev) 배포 관리 - ${yearMonth}`,
      };
    }

    // 2. 새 페이지 제목 생성
    const newTitle = `Dev) 배포 관리 - ${deploymentType} ${date}`;

    // 3. 중복 페이지 확인
    const duplicate = await checkDuplicatePage(
      parentPage.id,
      newTitle,
      email,
      token
    );

    if (duplicate.exists) {
      return {
        success: false,
        error: '이미 같은 배포 종류와 날짜의 배포대장이 존재합니다.',
        existingPageUrl: duplicate.pageUrl,
      };
    }

    // 4. 원본 페이지 가져오기 (가장 최근 배포대장 사용)
    // TODO: 프로젝트별로 다른 템플릿을 사용할 수 있도록 확장 가능
    const SOURCE_PAGE_ID = '275776098'; // hotfix 2025-12-31
    const SOURCE_DATE = '251231';

    const sourceResponse = await axios.get(
      `${CONFLUENCE_BASE_URL}/rest/api/content/${SOURCE_PAGE_ID}`,
      {
        params: {
          expand: 'body.storage',
        },
        auth: {
          username: email,
          password: token,
        },
        headers: {
          Accept: 'application/json',
        },
        httpsAgent,
      }
    );

    const sourceHtml = sourceResponse.data.body.storage.value;

    // 5. HTML 변환 - 날짜 치환
    let newHtml = sourceHtml.replace(new RegExp(SOURCE_DATE, 'g'), shortDate);

    // 6. JQL labels 조건 변환 (배포 타입에 따라)
    newHtml = transformLabelsInJql(newHtml, deploymentType, shortDate);

    // 7. 두레이 테이블 데이터 정리 (헤더 + 빈 행 3개)
    const doreiTableMatch = newHtml.match(
      /(<h1[^>]*>두레이<\/h1><table[^>]*>[\s\S]*?<tbody>)([\s\S]*?)(<\/tbody><\/table>)/
    );

    if (doreiTableMatch) {
      const tableStart = doreiTableMatch[1];
      const tableBody = doreiTableMatch[2];
      const tableEnd = doreiTableMatch[3];

      const headerMatch = tableBody.match(/(<tr[^>]*>[\s\S]*?<\/tr>)/);

      if (headerMatch) {
        const headerRow = headerMatch[1];

        // 빈 데이터 행 3개 생성
        const emptyRows = [2, 3, 4]
          .map(
            (num) => `
<tr ac:local-id="empty-row-${num}">
  <td class="numberingColumn">${num}</td>
  <td data-highlight-colour="#f0f1f2" ac:local-id="empty-cell-${num}-1"><p local-id="empty-p-${num}-1" /></td>
  <td ac:local-id="empty-cell-${num}-2"><p local-id="empty-p-${num}-2" /></td>
  <td ac:local-id="empty-cell-${num}-3"><p local-id="empty-p-${num}-3" /></td>
  <td ac:local-id="empty-cell-${num}-4"><p local-id="empty-p-${num}-4" /></td>
  <td ac:local-id="empty-cell-${num}-5"><p local-id="empty-p-${num}-5" /></td>
  <td ac:local-id="empty-cell-${num}-6"><p local-id="empty-p-${num}-6" /></td>
  <td ac:local-id="empty-cell-${num}-7"><p local-id="empty-p-${num}-7" /></td>
  <td ac:local-id="empty-cell-${num}-8"><p local-id="empty-p-${num}-8" /></td>
  <td ac:local-id="empty-cell-${num}-9"><p local-id="empty-p-${num}-9" /></td>
</tr>`
          )
          .join('');

        const cleanedTable = `${tableStart}${headerRow}${emptyRows}${tableEnd}`;
        newHtml = newHtml.replace(
          /(<h1[^>]*>두레이<\/h1><table[^>]*>[\s\S]*?<tbody>)([\s\S]*?)(<\/tbody><\/table>)/,
          cleanedTable
        );
      }
    }

    // 8. 새 페이지 생성
    const createResponse = await axios.post(
      `${CONFLUENCE_BASE_URL}/rest/api/content`,
      {
        type: 'page',
        title: newTitle,
        space: {
          key: SPACE_KEY,
        },
        ancestors: [
          {
            id: parentPage.id,
          },
        ],
        body: {
          storage: {
            value: newHtml,
            representation: 'storage',
          },
        },
      },
      {
        auth: {
          username: email,
          password: token,
        },
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        httpsAgent,
      }
    );

    const newPage = createResponse.data;
    const pageUrl = `${CONFLUENCE_BASE_URL}${newPage._links.webui}`;

    return {
      success: true,
      pageId: newPage.id,
      pageUrl: pageUrl,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorMessage = error.response?.data?.message || error.message;

      // 중복 제목 에러 처리
      if (errorMessage.includes('already exists')) {
        return {
          success: false,
          error: '이미 같은 제목의 페이지가 존재합니다.',
        };
      }

      return {
        success: false,
        error: errorMessage,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
