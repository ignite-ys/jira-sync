/**
 * 동적 상태 전이(Transition) 헬퍼
 * BFS를 사용하여 현재 상태에서 타겟 상태까지의 최단 경로를 찾아 순차 실행
 */

import { STATUS_WORKFLOW, STATUS_TARGET_MAPPING } from '@/lib/constants/jira';

export type JiraInstance = 'ignite' | 'hmg';

interface TransitionPath {
  /** 거쳐야 할 상태 ID 목록 (현재 상태 제외, 타겟 상태 포함) */
  statusPath: string[];
  /** 실행해야 할 transition ID 목록 */
  transitionPath: string[];
}

interface TransitionResult {
  success: boolean;
  stepsExecuted: number;
  finalStatusId?: string;
  error?: string;
}

/**
 * BFS로 현재 상태에서 타겟 상태까지의 최단 경로 탐색
 */
export function findTransitionPath(
  instance: JiraInstance,
  currentStatusId: string,
  targetStatusId: string
): TransitionPath | null {
  // 이미 타겟 상태인 경우
  if (currentStatusId === targetStatusId) {
    return { statusPath: [], transitionPath: [] };
  }

  const workflow = STATUS_WORKFLOW[instance.toUpperCase() as 'IGNITE' | 'HMG'];
  if (!workflow) {
    return null;
  }

  // BFS 탐색
  const queue: Array<{ statusId: string; path: string[]; transitions: string[] }> = [
    { statusId: currentStatusId, path: [], transitions: [] },
  ];
  const visited = new Set<string>([currentStatusId]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const nextTransitions = workflow[current.statusId];

    if (!nextTransitions) continue;

    for (const [nextStatusId, transitionId] of Object.entries(nextTransitions)) {
      if (visited.has(nextStatusId)) continue;

      const newPath = [...current.path, nextStatusId];
      const newTransitions = [...current.transitions, transitionId];

      // 타겟 도달
      if (nextStatusId === targetStatusId) {
        return {
          statusPath: newPath,
          transitionPath: newTransitions,
        };
      }

      visited.add(nextStatusId);
      queue.push({
        statusId: nextStatusId,
        path: newPath,
        transitions: newTransitions,
      });
    }
  }

  // 경로 없음
  return null;
}

/**
 * FEHG 상태 ID를 타겟 인스턴스의 상태 ID로 매핑
 */
export function getTargetStatusId(
  instance: JiraInstance,
  fehgStatusId: string
): string | null {
  const mapping = STATUS_TARGET_MAPPING[instance.toUpperCase() as 'IGNITE' | 'HMG'];
  return mapping?.[fehgStatusId] || null;
}

/**
 * 순차적으로 transition 실행
 * @param issueKey 이슈 키
 * @param transitionPath 실행할 transition ID 목록
 * @param executeTransition transition 실행 함수 (의존성 주입)
 * @param getCurrentStatus 현재 상태 조회 함수 (의존성 주입, 검증용)
 * @param delayMs 각 transition 사이 딜레이 (ms)
 */
export async function executeTransitionPath(
  issueKey: string,
  transitionPath: string[],
  executeTransition: (issueKey: string, transitionId: string) => Promise<{ success: boolean; error?: string }>,
  getCurrentStatus?: (issueKey: string) => Promise<string | null>,
  delayMs: number = 100
): Promise<TransitionResult> {
  if (transitionPath.length === 0) {
    return { success: true, stepsExecuted: 0 };
  }

  let stepsExecuted = 0;

  for (const transitionId of transitionPath) {
    try {
      const result = await executeTransition(issueKey, transitionId);

      if (!result.success) {
        return {
          success: false,
          stepsExecuted,
          error: result.error || `Transition ${transitionId} 실패`,
        };
      }

      stepsExecuted++;

      // 다음 transition 전 약간의 딜레이 (Jira API 안정성)
      if (stepsExecuted < transitionPath.length && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    } catch (error) {
      return {
        success: false,
        stepsExecuted,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // 최종 상태 검증 (선택적)
  let finalStatusId: string | undefined;
  if (getCurrentStatus) {
    finalStatusId = (await getCurrentStatus(issueKey)) || undefined;
  }

  return {
    success: true,
    stepsExecuted,
    finalStatusId,
  };
}

/**
 * 상태 동기화 통합 함수
 * FEHG 상태 ID를 받아서 타겟 인스턴스의 이슈를 해당 상태로 전이
 */
export async function syncStatusWithPath(
  instance: JiraInstance,
  issueKey: string,
  fehgStatusId: string,
  currentTargetStatusId: string,
  executeTransition: (issueKey: string, transitionId: string) => Promise<{ success: boolean; error?: string }>,
  logger?: { info: (msg: string) => void; error: (msg: string) => void; success: (msg: string) => void }
): Promise<TransitionResult> {
  // 1. FEHG 상태 → 타겟 상태 매핑
  const targetStatusId = getTargetStatusId(instance, fehgStatusId);

  if (!targetStatusId) {
    const error = `${fehgStatusId}: 매핑된 타겟 상태 없음`;
    logger?.error(`${issueKey}: ${error}`);
    return { success: false, stepsExecuted: 0, error };
  }

  // 2. 이미 타겟 상태인 경우 스킵
  if (currentTargetStatusId === targetStatusId) {
    logger?.info(`${issueKey}: 이미 타겟 상태 (${targetStatusId})`);
    return { success: true, stepsExecuted: 0, finalStatusId: targetStatusId };
  }

  // 3. 경로 탐색
  const path = findTransitionPath(instance, currentTargetStatusId, targetStatusId);

  if (!path) {
    const error = `${currentTargetStatusId} → ${targetStatusId}: 전이 경로 없음`;
    logger?.error(`${issueKey}: ${error}`);
    return { success: false, stepsExecuted: 0, error };
  }

  logger?.info(
    `${issueKey}: 상태 전이 경로 발견 (${path.transitionPath.length}단계: ${path.transitionPath.join(' → ')})`
  );

  // 4. 순차 실행
  const result = await executeTransitionPath(issueKey, path.transitionPath, executeTransition);

  if (result.success) {
    logger?.success(`${issueKey}: 상태 동기화 완료 (${result.stepsExecuted}단계 실행)`);
  } else {
    logger?.error(`${issueKey}: 상태 동기화 실패 - ${result.error}`);
  }

  return result;
}
