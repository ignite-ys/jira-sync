// HMG Jira 프로젝트 동기화 (FEHG → AUTOWAY)

import { JiraIssue, JiraIssueCreatePayload } from '@/lib/types/jira';
import { SyncResult } from './types';
import { SyncLogger } from './logger';
import {
  mapFieldsForAutoway,
  extractAutowayKey,
  isValidAutowayLink,
} from './field-mapper';
import { syncStatusWithPath } from './transition-helper';
import { jira } from '@/lib/services/jira';
import { IGNITE_CUSTOM_FIELDS, JIRA_ENDPOINTS } from '@/lib/constants/jira';

/**
 * AUTOWAY 이슈 생성 시 사용할 issuetype 캐시
 * - HMG Jira에서 프로젝트별로 허용되는 이슈 타입(이름/로캘)이 다를 수 있어 name 하드코딩이 깨질 수 있음
 * - 가능하면 issuetype "id"로 생성하도록 함
 */
let autowayCreateIssueTypeIdCache: string | null = null;

/**
 * HMG 프로젝트 동기화 서비스
 * FEHG → AUTOWAY 동기화 담당
 */
export class HMGSyncService {
  constructor(private logger: SyncLogger) {}

  private async resolveAutowayCreateIssueType(): Promise<
    { id: string } | { name: string }
  > {
    // 이미 한번 찾았으면 재사용
    if (autowayCreateIssueTypeIdCache) {
      return { id: autowayCreateIssueTypeIdCache };
    }

    try {
      const projectResult = await jira.hmg.getProject('AUTOWAY');
      const projectData = projectResult.success ? projectResult.data : null;

      // Jira /project/{key} 응답에는 issueTypes가 포함됨(타입 정의엔 빠져있어서 any 캐스팅)
      const issueTypes = (projectData as unknown as { issueTypes?: unknown })
        ?.issueTypes as Array<{
        id: string;
        name: string;
        subtask?: boolean;
      }> | null;

      if (!issueTypes || issueTypes.length === 0) {
        this.logger.warning(
          'AUTOWAY: 프로젝트 issueTypes 조회 실패(비어있음) → issuetype name으로 fallback'
        );
        return { name: '작업' };
      }

      const nonSubtaskTypes = issueTypes.filter((t) => !t.subtask);
      const preferredNames = [
        '작업',
        'Task',
        '업무',
        '스토리',
        'Story',
        '버그',
        'Bug',
      ];

      const preferred = nonSubtaskTypes.find((t) =>
        preferredNames.includes(t.name)
      );
      const chosen = preferred ?? nonSubtaskTypes[0] ?? issueTypes[0];

      autowayCreateIssueTypeIdCache = chosen.id;
      this.logger.info(
        `AUTOWAY: issuetype 선택 → "${chosen.name}" (id=${chosen.id})`
      );
      return { id: chosen.id };
    } catch (e) {
      this.logger.warning(
        `AUTOWAY: issuetype 조회 중 예외 → name fallback ("작업") - ${
          e instanceof Error ? e.message : String(e)
        }`
      );
      return { name: '작업' };
    }
  }

  /**
   * FEHG 티켓을 AUTOWAY로 동기화
   */
  async syncTicket(
    fehgTicket: JiraIssue,
    assigneeAccountId: string
  ): Promise<SyncResult | null> {
    try {
      const customFields = fehgTicket.fields;
      const rawLink = customFields[IGNITE_CUSTOM_FIELDS.HMG_JIRA_LINK];
      const hmgLinkField =
        typeof rawLink === 'string'
          ? rawLink.trim()
          : Array.isArray(rawLink)
            ? rawLink[0]
              ? String(rawLink[0]).trim()
              : ''
            : rawLink && typeof rawLink === 'object' && 'value' in rawLink
              ? String((rawLink as { value?: unknown }).value ?? '').trim()
              : '';

      if (hmgLinkField) {
        this.logger.info(
          `${fehgTicket.key}: customfield_10306 감지됨 → ${hmgLinkField}`
        );
      } else {
        this.logger.info(
          `${fehgTicket.key}: customfield_10306 비어 있음 → 신규 생성`
        );
      }

      // customfield_10306 확인 및 분기
      // 참고: 구 HMG URL은 사전 마이그레이션으로 모두 신 URL로 변환됨
      if (!hmgLinkField || !isValidAutowayLink(hmgLinkField)) {
        // 신규 생성 플로우: customfield_10306이 비어있거나 AUTOWAY 키가 없음
        return await this.createAndLinkAutowayTicket(
          fehgTicket,
          assigneeAccountId
        );
      }

      // 기존 티켓 업데이트 플로우: customfield_10306에서 AUTOWAY 키 추출
      const autowayKey = extractAutowayKey(hmgLinkField);
      if (!autowayKey) {
        this.logger.warning(
          `${fehgTicket.key}: AUTOWAY 키 추출 실패 (${hmgLinkField}) - 신규 생성`
        );
        return await this.createAndLinkAutowayTicket(
          fehgTicket,
          assigneeAccountId
        );
      }

      return await this.updateAutowayTicket(
        fehgTicket,
        autowayKey,
        assigneeAccountId
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `${fehgTicket.key}: AUTOWAY 동기화 실패 - ${errorMessage}`
      );
      return null;
    }
  }

  /**
   * AUTOWAY 티켓 신규 생성 및 FEHG에 링크
   */
  private async createAndLinkAutowayTicket(
    fehgTicket: JiraIssue,
    assigneeAccountId: string
  ): Promise<SyncResult> {
    try {
      this.logger.info(`${fehgTicket.key}: AUTOWAY 티켓 생성 시작...`);

      // 1. 필드 매핑
      const mappedFields = mapFieldsForAutoway(fehgTicket, assigneeAccountId);
      const autowayIssueType = await this.resolveAutowayCreateIssueType();

      // 2. AUTOWAY 티켓 생성
      const createPayload: JiraIssueCreatePayload = {
        fields: {
          project: { key: 'AUTOWAY' },
          issuetype: autowayIssueType,
          summary: fehgTicket.fields.summary,
          // 추후 적용: customfield_10002: autowayEpicKey (Epic Link)
          ...mappedFields,
        },
      };

      const createResult = await jira.hmg.createIssue(createPayload);

      if (!createResult.success || !createResult.data) {
        // Jira API 에러 상세 로그
        const errorDetails = (
          createResult as { details?: unknown; error?: string }
        ).details;
        if (errorDetails) {
          this.logger.error(
            `${fehgTicket.key}: Jira API 에러 상세 → ${JSON.stringify(errorDetails)}`
          );
        }
        throw new Error(createResult.error || 'AUTOWAY 티켓 생성 실패');
      }

      const autowayKey = createResult.data.key;
      this.logger.success(`${autowayKey}: AUTOWAY 티켓 생성 완료`);

      // 3. FEHG 티켓의 customfield_10306에 URL 저장
      const autowayUrl = `${JIRA_ENDPOINTS.HMG}/browse/${autowayKey}`;
      const linkResult = await jira.ignite.updateIssueFields(fehgTicket.key, {
        [IGNITE_CUSTOM_FIELDS.HMG_JIRA_LINK]: autowayUrl,
      });

      if (!linkResult.success) {
        this.logger.warning(
          `${fehgTicket.key}: AUTOWAY 링크 저장 실패 (티켓은 생성됨)`
        );
      } else {
        this.logger.success(`${fehgTicket.key}: AUTOWAY 링크 저장 완료`);
      }

      // 4. 생성된 AUTOWAY 티켓 업데이트 (상태 동기화)
      await this.syncAutowayStatus(fehgTicket, autowayKey);

      return {
        fehgKey: fehgTicket.key,
        targetKey: autowayKey,
        targetProject: 'AUTOWAY',
        success: true,
        message: '신규 생성 및 동기화 완료',
        isNewlyCreated: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `${fehgTicket.key}: AUTOWAY 생성 실패 - ${errorMessage}`
      );

      return {
        fehgKey: fehgTicket.key,
        targetKey: '',
        targetProject: 'AUTOWAY',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * 기존 AUTOWAY 티켓 업데이트
   */
  private async updateAutowayTicket(
    fehgTicket: JiraIssue,
    autowayKey: string,
    assigneeAccountId: string
  ): Promise<SyncResult> {
    try {
      this.logger.info(`${autowayKey}: 업데이트 시작...`);

      // 1. 필드 매핑
      const mappedFields = mapFieldsForAutoway(fehgTicket, assigneeAccountId);

      // 2. 필드 매핑 로그
      this.logger.info(
        `${autowayKey}: 업데이트 필드 → ${JSON.stringify(Object.keys(mappedFields))}`
      );

      // 3. 필드 업데이트
      const updateResult = await jira.hmg.updateIssue(autowayKey, {
        fields: mappedFields,
      });

      if (!updateResult.success) {
        // Jira API 에러 상세 로그
        const errorDetails = (
          updateResult as { details?: unknown; error?: string }
        ).details;
        if (errorDetails) {
          this.logger.error(
            `${autowayKey}: Jira API 에러 상세 → ${JSON.stringify(errorDetails)}`
          );
        }
        throw new Error(updateResult.error || '필드 업데이트 실패');
      }

      this.logger.success(`${autowayKey}: 필드 업데이트 완료`);

      // 3. 상태 동기화
      await this.syncAutowayStatus(fehgTicket, autowayKey);

      return {
        fehgKey: fehgTicket.key,
        targetKey: autowayKey,
        targetProject: 'AUTOWAY',
        success: true,
        message: '동기화 완료',
        isNewlyCreated: false,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`${autowayKey}: 업데이트 실패 - ${errorMessage}`);

      return {
        fehgKey: fehgTicket.key,
        targetKey: autowayKey,
        targetProject: 'AUTOWAY',
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * AUTOWAY 티켓 상태 동기화 (동적 경로 탐색 사용)
   */
  private async syncAutowayStatus(
    fehgTicket: JiraIssue,
    autowayKey: string
  ): Promise<void> {
    const fehgStatusId = fehgTicket.fields.status?.id;
    if (!fehgStatusId) return;

    try {
      // 1. 현재 AUTOWAY 티켓의 상태 조회
      const autowayIssue = await jira.hmg.getIssue(autowayKey);
      if (!autowayIssue.success || !autowayIssue.data) {
        this.logger.warning(`${autowayKey}: 상태 조회 실패 - 상태 동기화 스킵`);
        return;
      }

      const currentStatusId = autowayIssue.data.fields.status?.id;
      if (!currentStatusId) {
        this.logger.warning(`${autowayKey}: 현재 상태 ID 없음 - 상태 동기화 스킵`);
        return;
      }

      // 2. 동적 경로 탐색 및 순차 실행
      const result = await syncStatusWithPath(
        'hmg',
        autowayKey,
        fehgStatusId,
        currentStatusId,
        async (issueKey, transitionId) => {
          return await jira.hmg.updateIssueStatus(issueKey, transitionId);
        },
        this.logger
      );

      if (!result.success && result.stepsExecuted > 0) {
        this.logger.warning(
          `${autowayKey}: 상태 동기화 부분 완료 (${result.stepsExecuted}단계 실행 후 실패)`
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warning(
        `${autowayKey}: 상태 동기화 실패 (필드는 업데이트됨) - ${errorMessage}`
      );
    }
  }
}
