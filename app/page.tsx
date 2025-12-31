'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RefreshCw, User, Plus, ExternalLink, Network } from 'lucide-react';
import { toast } from 'sonner';
import {
  JIRA_USER_LIST,
  JIRA_USERS,
  JIRA_ENDPOINTS,
  // ALLOWED_FEHG_TO_HMG_EPIC_IDS, // handleCheckAutowayTargets에서 사용 (현재 주석 처리됨)
  // IGNITE_CUSTOM_FIELDS, // handleMigrateOldHmgLinks에서 사용 (현재 주석 처리됨)
} from '@/lib/constants/jira';
import { jira } from '@/lib/services/jira';
import { JiraIssue } from '@/lib/types/jira';
import {
  SyncOrchestrator,
  SyncLog,
  SyncSummary,
  SyncTargetProject,
} from '@/lib/services/sync';

const LOG_HIGHLIGHT_PATTERN =
  '(FEHG-\\d+|KQ-\\d+|HDD-\\d+|HB-\\d+|AUTOWAY-\\d+|성공|실패|경고|오류|에러|동기화|완료)';

function emphasizeLogMessage(message: string): ReactNode[] {
  const regex = new RegExp(LOG_HIGHLIGHT_PATTERN, 'g');
  const segments: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(message)) !== null) {
    if (match.index > lastIndex) {
      segments.push(message.slice(lastIndex, match.index));
    }

    segments.push(
      <span key={`${match.index}-${match[0]}`} className="font-semibold">
        {match[0]}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < message.length) {
    segments.push(message.slice(lastIndex));
  }

  return segments.length > 0 ? segments : [message];
}

export default function Home() {
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [userSelectError, setUserSelectError] = useState(false);
  const [syncType, setSyncType] = useState<string>('전체'); // 기본값: 전체
  const [epicOrTicketId, setEpicOrTicketId] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState(false);

  // 동기화 로그 및 결과
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);

  // 에픽 단위 동기화
  const [fehgEpics, setFehgEpics] = useState<JiraIssue[]>([]);
  const [isLoadingEpics, setIsLoadingEpics] = useState(false);
  const [selectedEpicForSync, setSelectedEpicForSync] = useState<string>('');
  const [isEpicSyncing, setIsEpicSyncing] = useState(false);

  // 정적 분석(Black Duck) 조회
  const [staticAnalysisProject, setStaticAnalysisProject] =
    useState<string>('');
  const [isStaticAnalysisRunning, setIsStaticAnalysisRunning] = useState(false);
  type BlackDuckRiskCategories = {
    LICENSE?: Record<string, number>;
    VULNERABILITY?: Record<string, number>;
  };

  type BlackDuckUiResult = {
    ok: boolean | null;
    project: { id?: string | null; name?: string | null; url?: string | null };
    version: { name?: string | null; url?: string | null } | null;
    scan?: { scannedAt?: string | null; source?: string | null } | null;
    policy: { status?: string | null } | null;
    riskProfile?: { raw?: { categories?: BlackDuckRiskCategories } } | null;
  };

  // 프로젝트별 정적 분석 결과(향후 sonarqube도 같이 담을 예정)
  const [staticAnalysisResults, setStaticAnalysisResults] = useState<
    Record<
      string,
      {
        blackduck?: BlackDuckUiResult;
        sonarqube?: {
          ok: boolean;
          projectKey: string;
          baseUrl?: string;
          projectUrl?: string;
          analysisDate?: string | null;
          qualityGateStatus: string;
          conditions: Array<{
            status?: string;
            metricKey?: string;
            actualValue?: string;
            errorThreshold?: string;
            comparator?: string;
          }>;
        };
      }
    >
  >({});

  const userSelectRef = useRef<HTMLButtonElement>(null);
  const resultScrollRef = useRef<HTMLDivElement | null>(null);
  const previousLogCountRef = useRef(0);

  useEffect(() => {
    const viewport = resultScrollRef.current?.querySelector<HTMLDivElement>(
      '[data-radix-scroll-area-viewport]'
    );

    if (!viewport) return;

    const behavior: ScrollBehavior =
      syncLogs.length > previousLogCountRef.current ? 'smooth' : 'auto';
    previousLogCountRef.current = syncLogs.length;

    const scrollToBottom = () =>
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior,
      });

    if (behavior === 'smooth') {
      requestAnimationFrame(scrollToBottom);
    } else {
      scrollToBottom();
    }
  }, [syncLogs]);

  useEffect(() => {
    if (!syncSummary) return;

    const viewport = resultScrollRef.current?.querySelector<HTMLDivElement>(
      '[data-radix-scroll-area-viewport]'
    );

    if (!viewport) return;

    requestAnimationFrame(() =>
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: 'smooth',
      })
    );
  }, [syncSummary]);

  // FEHG 완료되지 않은 에픽 조회 (페이지 로드 시)
  useEffect(() => {
    const loadEpics = async () => {
      setIsLoadingEpics(true);
      try {
        const result = await jira.ignite.getFEHGIncompleteEpics();
        if (result.success && result.data) {
          setFehgEpics(result.data.issues);
        }
      } catch {
        // 에픽 로드 실패 시 조용히 처리
      } finally {
        setIsLoadingEpics(false);
      }
    };

    loadEpics();
  }, []);

  // 에픽/티켓 지정 모드인지 확인
  const isSpecificMode = syncType === '에픽 지정' || syncType === '티켓 지정';

  // 에픽 summary에 따라 프로젝트 태그 색상 클래스 반환
  const getProjectColorClass = (summary: string): string => {
    if (summary.startsWith('[CPO]')) {
      return 'text-blue-700 font-medium data-[highlighted]:bg-blue-50 data-[state=checked]:bg-blue-100 data-[state=checked]:text-blue-800';
    }
    if (summary.startsWith('[GW]')) {
      return 'text-green-700 font-medium data-[highlighted]:bg-green-50 data-[state=checked]:bg-green-100 data-[state=checked]:text-green-800';
    }
    if (summary.startsWith('[HB]')) {
      return 'text-purple-700 font-medium data-[highlighted]:bg-purple-50 data-[state=checked]:bg-purple-100 data-[state=checked]:text-purple-800';
    }
    return 'text-gray-700';
  };

  // 동기화 타입 변경 시 추가 입력 초기화
  const handleSyncTypeChange = (value: string) => {
    setSyncType(value);
    if (value !== '에픽 지정' && value !== '티켓 지정') {
      setEpicOrTicketId('');
    }
  };

  // 숫자만 입력 가능하도록 처리
  const handleIdInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
    setEpicOrTicketId(value);
  };

  const handleUserChange = (value: string) => {
    setSelectedUser(value);
    if (value) {
      setUserSelectError(false);
    }
  };

  const handleStaticAnalysisProjectChange = (value: string) => {
    setStaticAnalysisProject(value);
  };

  const handleRunStaticAnalysis = async () => {
    if (!staticAnalysisProject) {
      toast.error('프로젝트를 선택해주세요.');
      return;
    }

    const currentProjectKey = staticAnalysisProject;

    // TODO: 프로젝트별 Black Duck projectId 매핑 확장
    const projectIdByProject: Record<string, string | undefined> = {
      groupware: '0c338bd6-47dd-4f2b-bb9a-64a7c0515ed7',
      'hmg-board': '8cbaf4df-8cb3-418c-9f45-af68d3736811',
      cpo: '026cf752-678f-4430-973e-32163f1785bc',
    };

    const projectId = projectIdByProject[currentProjectKey];
    if (!projectId) {
      toast.error('이 프로젝트는 아직 Black Duck 설정이 연결되지 않았습니다.');
      return;
    }

    const sonarProjectKeyByProject: Record<string, string | undefined> = {
      cpo: 'C1162_kia-cpo-bo-web',
      groupware: 'D0754_hmg-groupware.fe',
      'hmg-board': 'F2156-hmg-board-FE',
    };
    const sonarProjectKey = sonarProjectKeyByProject[currentProjectKey];

    resetResultArea();
    setIsStaticAnalysisRunning(true);

    try {
      const [bdRes, sonarRes] = await Promise.allSettled([
        fetch(
          `/api/blackduck/status?projectId=${encodeURIComponent(projectId)}&projectKey=${encodeURIComponent(
            currentProjectKey
          )}`,
          { method: 'GET' }
        ).then(async (r) => ({ ok: r.ok, json: await r.json() })),
        sonarProjectKey
          ? fetch(
              `/api/sonarqube/status?projectKey=${encodeURIComponent(
                sonarProjectKey
              )}`,
              { method: 'GET' }
            ).then(async (r) => ({ ok: r.ok, json: await r.json() }))
          : Promise.resolve({ ok: false, json: { success: false } }),
      ]);

      const blackduck =
        bdRes.status === 'fulfilled' &&
        bdRes.value.ok &&
        bdRes.value.json?.success
          ? (bdRes.value.json.data as BlackDuckUiResult)
          : undefined;

      const sonarqube =
        sonarRes.status === 'fulfilled' &&
        sonarRes.value.ok &&
        sonarRes.value.json?.success
          ? (sonarRes.value.json.data as {
              ok: boolean;
              projectKey: string;
              baseUrl?: string;
              projectUrl?: string;
              analysisDate?: string | null;
              qualityGateStatus: string;
              conditions: Array<{
                status?: string;
                metricKey?: string;
                actualValue?: string;
                errorThreshold?: string;
                comparator?: string;
              }>;
            })
          : undefined;

      if (!blackduck && !sonarqube) {
        const bdErr =
          bdRes.status === 'fulfilled' ? bdRes.value.json?.error : null;
        const sonarErr =
          sonarRes.status === 'fulfilled' ? sonarRes.value.json?.error : null;
        throw new Error(bdErr || sonarErr || '정적 분석 조회에 실패했습니다.');
      }

      setStaticAnalysisResults({
        [currentProjectKey]: {
          ...(blackduck ? { blackduck } : {}),
          ...(sonarqube ? { sonarqube } : {}),
        },
      });
      toast.success('정적 분석 상태를 확인했습니다.');
    } catch (error) {
      toast.error(
        `정적 분석 조회 실패: ${error instanceof Error ? error.message : String(error)}`
      );
      setStaticAnalysisResults({});
    } finally {
      setIsStaticAnalysisRunning(false);
    }
  };

  const isTicketSyncReady =
    !!selectedUser && (!isSpecificMode || epicOrTicketId.trim() !== '');
  const isStaticAnalysisReady = staticAnalysisProject.trim() !== '';

  const resetResultArea = () => {
    // 어떤 작업이든 새로 시작하면 결과 영역은 초기화하고 새 결과만 노출
    setSyncLogs([]);
    setSyncSummary(null);
    setStaticAnalysisResults({});
  };

  const handleSync = async () => {
    // 사용자 선택 검증
    if (!selectedUser) {
      setUserSelectError(true);
      toast.error('담당자를 선택해주세요.');
      userSelectRef.current?.focus();
      return;
    }

    // 동기화 타입 검증
    if (!syncType) {
      toast.error('동기화 유형을 선택해주세요.');
      return;
    }

    // 에픽/티켓 지정 모드일 때 추가 검증
    if (isSpecificMode) {
      if (!epicOrTicketId) {
        toast.error(
          `${syncType === '에픽 지정' ? '에픽' : '티켓'} 번호를 입력해주세요.`
        );
        return;
      }
    }

    setUserSelectError(false);
    resetResultArea();
    setIsSyncing(true);

    try {
      // 사용자 정보 가져오기
      const userInfo = JIRA_USERS[selectedUser as keyof typeof JIRA_USERS];
      if (!userInfo) {
        toast.error('사용자 정보를 찾을 수 없습니다.');
        return;
      }

      // 대상 프로젝트 결정
      let targetProjects: SyncTargetProject[] | undefined;
      if (syncType !== '전체') {
        const match = syncType.match(/FEHG -> (\w+)/);
        if (match) {
          targetProjects = [match[1] as SyncTargetProject];
        }
      }

      // 동기화 시작 메시지
      let message = `${selectedUser} 담당자 - "${syncType}" 동기화를 시작합니다.`;
      if (isSpecificMode) {
        const fehgKey = `FEHG-${epicOrTicketId}`;
        message = `${selectedUser} 담당자 - ${fehgKey} ${syncType === '에픽 지정' ? '에픽' : '티켓'} 동기화를 시작합니다.`;
      }
      toast.success(message);

      // 동기화 실행
      const orchestrator = new SyncOrchestrator((log) => {
        setSyncLogs((prev) => [...prev, log]);
      });

      const summary = await orchestrator.execute({
        assigneeAccountId: userInfo.igniteAccountId,
        targetProjects,
        epicId: syncType === '에픽 지정' ? epicOrTicketId : undefined,
        ticketId: syncType === '티켓 지정' ? epicOrTicketId : undefined,
        chunkSize: 15,
      });

      setSyncSummary(summary);

      // 결과 토스트
      if (summary.totalFailed === 0) {
        toast.success(`동기화 완료! 총 ${summary.totalSuccess}개 티켓 처리`);
      } else {
        toast.warning(
          `동기화 완료 (성공: ${summary.totalSuccess}, 실패: ${summary.totalFailed})`
        );
      }
    } catch (error) {
      toast.error(
        `동기화 실패: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsSyncing(false);
    }
  };

  // 에픽 단위 동기화 (담당자 무관)
  const handleEpicSync = async () => {
    if (!selectedEpicForSync) {
      toast.error('동기화할 에픽을 선택해주세요.');
      return;
    }

    resetResultArea();
    setIsEpicSyncing(true);

    try {
      // 에픽 번호 추출 (FEHG-123 → 123)
      const epicIdMatch = selectedEpicForSync.match(/FEHG-(\d+)/);
      if (!epicIdMatch) {
        toast.error('올바르지 않은 에픽 형식입니다.');
        return;
      }

      const epicId = epicIdMatch[1];
      const epicInfo = fehgEpics.find((e) => e.key === selectedEpicForSync);

      toast.info(
        `${selectedEpicForSync} 에픽 단위 동기화를 시작합니다... (담당자 무관)`
      );

      // 동기화 실행 (syncAllInEpic: true로 담당자 무관 동기화)
      const orchestrator = new SyncOrchestrator((log) => {
        setSyncLogs((prev) => [...prev, log]);
      });

      const summary = await orchestrator.execute({
        epicId,
        syncAllInEpic: true, // 담당자 무관하게 에픽 하위 전체 동기화
        chunkSize: 15,
      });

      setSyncSummary(summary);

      // 결과 토스트
      if (summary.totalFailed === 0) {
        toast.success(
          `에픽 동기화 완료! 총 ${summary.totalSuccess}개 티켓 처리 (${epicInfo?.fields.summary || selectedEpicForSync})`
        );
      } else {
        toast.warning(
          `에픽 동기화 완료 (성공: ${summary.totalSuccess}, 실패: ${summary.totalFailed})`
        );
      }
    } catch (error) {
      toast.error(
        `에픽 동기화 실패: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setIsEpicSyncing(false);
    }
  };

  // AUTOWAY 동기화 대상 확인 (필요시 주석 해제하여 사용)
  /* const handleCheckAutowayTargets = async () => {
    // ... (전체 로직 생략)
  }; */

  // 구 HMG URL → 신 HMG URL 마이그레이션 (마이그레이션 완료로 현재 미사용)
  // 필요시 주석 해제하여 사용
  /* const handleMigrateOldHmgLinks = async () => {
    // 사용자 선택 검증
    if (!selectedUser) {
      setUserSelectError(true);
      toast.error('담당자를 선택해주세요.');
      userSelectRef.current?.focus();
      return;
    }

    setUserSelectError(false);
    setIsSyncing(true);
    setSyncLogs([]);
    setSyncSummary(null);

    try {
      // 사용자 정보 가져오기
      const userInfo = JIRA_USERS[selectedUser as keyof typeof JIRA_USERS];
      if (!userInfo) {
        toast.error('사용자 정보를 찾을 수 없습니다.');
        return;
      }

      setSyncLogs([
        {
          timestamp: new Date().toLocaleTimeString('ko-KR'),
          level: 'info',
          message: `→ ${selectedUser} 담당자의 구 HMG 링크 마이그레이션 시작...`,
        },
      ]);

      // FEHG 티켓 조회 (모든 상태)
      const jql = `project = FEHG AND assignee = "${userInfo.igniteAccountId}" ORDER BY updated DESC`;
      const result = await jira.ignite.searchAllIssues(jql);

      if (!result.success || !result.data) {
        setSyncLogs((prev) => [
          ...prev,
          {
            timestamp: new Date().toLocaleTimeString('ko-KR'),
            level: 'error',
            message: `✗ 티켓 조회 실패: ${result.error || '알 수 없는 오류'}`,
          },
        ]);
        return;
      }

      const allTickets = result.data.issues;
      setSyncLogs((prev) => [
        ...prev,
        {
          timestamp: new Date().toLocaleTimeString('ko-KR'),
          level: 'success',
          message: `✓ 총 ${allTickets.length}개 티켓 조회 완료`,
        },
      ]);

      // 구 HMG URL이 있는 티켓 필터링
      const oldHmgTickets = allTickets.filter((ticket) => {
        const link = ticket.fields[IGNITE_CUSTOM_FIELDS.HMG_JIRA_LINK] as
          | string
          | undefined;
        return link && link.includes(JIRA_ENDPOINTS.HMG_OLD);
      });

      setSyncLogs((prev) => [
        ...prev,
        {
          timestamp: new Date().toLocaleTimeString('ko-KR'),
          level: 'info',
          message: `→ 구 HMG 링크 티켓: ${oldHmgTickets.length}개 발견`,
        },
      ]);

      if (oldHmgTickets.length === 0) {
        setSyncLogs((prev) => [
          ...prev,
          {
            timestamp: new Date().toLocaleTimeString('ko-KR'),
            level: 'warning',
            message: '⚠ 마이그레이션 대상 티켓이 없습니다',
          },
        ]);
        toast.warning('마이그레이션 대상 티켓이 없습니다');
        return;
      }

      setSyncLogs((prev) => [
        ...prev,
        {
          timestamp: new Date().toLocaleTimeString('ko-KR'),
          level: 'info',
          message: `━━━ 링크 마이그레이션 시작 (${oldHmgTickets.length}개) ━━━`,
        },
      ]);

      // 각 티켓의 링크 업데이트
      let successCount = 0;
      let failCount = 0;

      for (const ticket of oldHmgTickets) {
        const oldLink = ticket.fields[IGNITE_CUSTOM_FIELDS.HMG_JIRA_LINK] as
          | string
          | undefined;
        if (!oldLink) continue;

        // 구 URL → 신 URL 변경
        const newLink = oldLink.replace(
          JIRA_ENDPOINTS.HMG_OLD,
          JIRA_ENDPOINTS.HMG
        );

        try {
          const updateResult = await jira.ignite.updateIssueFields(ticket.key, {
            [IGNITE_CUSTOM_FIELDS.HMG_JIRA_LINK]: newLink,
          });

          if (updateResult.success) {
            setSyncLogs((prev) => [
              ...prev,
              {
                timestamp: new Date().toLocaleTimeString('ko-KR'),
                level: 'success',
                message: `✓ ${ticket.key}: ${oldLink} → ${newLink}`,
              },
            ]);
            successCount++;
          } else {
            setSyncLogs((prev) => [
              ...prev,
              {
                timestamp: new Date().toLocaleTimeString('ko-KR'),
                level: 'error',
                message: `✗ ${ticket.key}: 업데이트 실패 - ${updateResult.error}`,
              },
            ]);
            failCount++;
          }
        } catch (error) {
          setSyncLogs((prev) => [
            ...prev,
            {
              timestamp: new Date().toLocaleTimeString('ko-KR'),
              level: 'error',
              message: `✗ ${ticket.key}: 오류 발생 - ${error instanceof Error ? error.message : String(error)}`,
            },
          ]);
          failCount++;
        }
      }

      // 최종 결과
      setSyncLogs((prev) => [
        ...prev,
        {
          timestamp: new Date().toLocaleTimeString('ko-KR'),
          level: 'success',
          message: `━━━ 마이그레이션 완료: 성공 ${successCount}개, 실패 ${failCount}개 ━━━`,
        },
      ]);

      if (failCount === 0) {
        toast.success(
          `링크 마이그레이션 완료! ${successCount}개 티켓 업데이트`
        );
      } else {
        toast.warning(
          `링크 마이그레이션 완료 (성공: ${successCount}, 실패: ${failCount})`
        );
      }
    } catch (error) {
      setSyncLogs((prev) => [
        ...prev,
        {
          timestamp: new Date().toLocaleTimeString('ko-KR'),
          level: 'error',
          message: `✗ 오류 발생: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
      toast.error('링크 마이그레이션 중 오류가 발생했습니다');
    } finally {
      setIsSyncing(false);
    }
  }; */

  return (
    <main className="h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-6 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">FE1 Jira 통합 관리</h1>
            <p className="text-sm text-muted-foreground">
              여러 Jira 인스턴스를 자동화하고 관리합니다
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/templates">
              <Button variant="outline">
                <ExternalLink className="mr-2 h-4 w-4" />
                배포 템플릿
              </Button>
            </Link>
            <Link href="/flow-chart">
              <Button variant="outline">
                <Network className="mr-2 h-4 w-4" />
                Flow Chart
              </Button>
            </Link>
            <Link href="/create-epic">
              <Button variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                에픽 생성
              </Button>
            </Link>
            <Link href="/create-ticket">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                티켓 생성
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content: 2-Column Layout */}
      <div className="flex-1 container mx-auto px-6 py-6 overflow-hidden">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 h-full">
          {/* Left: Action Area */}
          <Card className="flex h-full flex-col overflow-hidden">
            <CardHeader>
              <CardTitle>작업 영역</CardTitle>
              <CardDescription>
                자동화 작업을 설정하고 실행합니다
              </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 space-y-6 overflow-y-auto pr-4">
              {/* User Selection - 최상단 */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <User className="h-4 w-4" />
                  담당자 선택
                  <span className="text-red-500">*</span>
                </label>
                <Select value={selectedUser} onValueChange={handleUserChange}>
                  <SelectTrigger
                    ref={userSelectRef}
                    className={
                      userSelectError ? 'border-red-500 focus:ring-red-500' : ''
                    }
                  >
                    <SelectValue placeholder="담당자를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    {JIRA_USER_LIST.map((user) => (
                      <SelectItem key={user.igniteAccountId} value={user.name}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {userSelectError && (
                  <p className="text-sm text-red-500">담당자를 선택해주세요.</p>
                )}
              </div>

              {/* 자동화 작업 */}
              <div className="border-t pt-6">
                <h3 className="text-sm font-semibold mb-4">자동화 작업</h3>

                {/* Ticket Sync Action */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">티켓 동기화</label>
                  <div className="flex gap-2">
                    <Select
                      value={syncType}
                      onValueChange={handleSyncTypeChange}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="동기화 유형을 선택하세요" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="전체">전체</SelectItem>
                        <SelectItem value="FEHG -> KQ">FEHG → KQ</SelectItem>
                        <SelectItem value="FEHG -> HDD">FEHG → HDD</SelectItem>
                        <SelectItem value="FEHG -> HB">FEHG → HB</SelectItem>
                        <SelectItem value="FEHG -> AUTOWAY">
                          FEHG → AUTOWAY
                        </SelectItem>
                        <SelectItem value="에픽 지정">에픽 지정</SelectItem>
                        <SelectItem value="티켓 지정">티켓 지정</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={handleSync}
                      disabled={!isTicketSyncReady || isSyncing}
                      className="min-w-[100px]"
                    >
                      <RefreshCw
                        className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`}
                      />
                      {isSyncing ? '동기화 중...' : '동기화'}
                    </Button>
                  </div>

                  {/* 에픽/티켓 지정 시 추가 입력 필드 */}
                  {isSpecificMode && (
                    <div className="space-y-2 pl-4 pb-3 border-l-2 border-muted">
                      <label className="text-sm font-medium text-muted-foreground">
                        {syncType === '에픽 지정'
                          ? 'FEHG 에픽 선택'
                          : 'FEHG 티켓 번호'}
                      </label>
                      {syncType === '에픽 지정' ? (
                        <Select
                          value={epicOrTicketId}
                          onValueChange={setEpicOrTicketId}
                          disabled={isLoadingEpics}
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={
                                isLoadingEpics
                                  ? '에픽 목록 로딩 중...'
                                  : '에픽을 선택하세요'
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {fehgEpics
                              .slice()
                              .sort((a, b) => {
                                // 1. 제목 기준 오름차순
                                const summaryCompare =
                                  a.fields.summary.localeCompare(
                                    b.fields.summary
                                  );
                                if (summaryCompare !== 0) return summaryCompare;
                                // 2. 티켓 번호 기준 오름차순
                                return a.key.localeCompare(b.key);
                              })
                              .map((epic) => {
                                // FEHG-123에서 123만 추출
                                const epicNumber = epic.key.replace(
                                  'FEHG-',
                                  ''
                                );
                                return (
                                  <SelectItem
                                    key={epic.id}
                                    value={epicNumber}
                                    className={getProjectColorClass(
                                      epic.fields.summary
                                    )}
                                  >
                                    {epic.key} - {epic.fields.summary}
                                  </SelectItem>
                                );
                              })}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          type="text"
                          inputMode="numeric"
                          placeholder={`번호를 입력하세요 (예: 123 → FEHG-123)`}
                          value={epicOrTicketId}
                          onChange={handleIdInput}
                          maxLength={10}
                        />
                      )}
                      <p className="text-xs text-muted-foreground">
                        {syncType === '에픽 지정'
                          ? fehgEpics.length === 0 && !isLoadingEpics
                            ? '진행 중인 에픽이 없습니다.'
                            : `FEHG-${epicOrTicketId || 'XXX'} 형태로 동기화됩니다`
                          : `숫자만 입력 (최대 10자) • FEHG-${epicOrTicketId || 'XXX'} 형태로 조회`}
                      </p>
                    </div>
                  )}

                  {/* AUTOWAY 대상 확인 버튼 (필요시 사용) */}
                  {/* <div className="pt-3 border-t space-y-2">
                    <Button
                      onClick={handleCheckAutowayTargets}
                      disabled={isSyncing}
                      variant="outline"
                      className="w-full"
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      AUTOWAY 동기화 대상 확인
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      담당자의 허용된 에픽 하위 티켓만 조회합니다
                    </p>
                  </div> */}
                </div>

                {/* 에픽 단위 동기화 */}
                <div className="pt-6 border-t space-y-3">
                  <label className="text-sm font-medium">
                    에픽 단위 동기화
                  </label>
                  <p className="text-xs text-muted-foreground -mt-1">
                    담당자와 관계없이 선택한 에픽의 모든 하위 티켓을
                    동기화합니다
                  </p>
                  <div className="flex gap-2">
                    <Select
                      value={selectedEpicForSync}
                      onValueChange={setSelectedEpicForSync}
                      disabled={isLoadingEpics || isEpicSyncing}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue
                          placeholder={
                            isLoadingEpics
                              ? '에픽 목록 로딩 중...'
                              : '에픽을 선택하세요'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {fehgEpics
                          .slice()
                          .sort((a, b) => {
                            const summaryCompare =
                              a.fields.summary.localeCompare(b.fields.summary);
                            if (summaryCompare !== 0) return summaryCompare;
                            return a.key.localeCompare(b.key);
                          })
                          .map((epic) => (
                            <SelectItem
                              key={epic.id}
                              value={epic.key}
                              className={getProjectColorClass(
                                epic.fields.summary
                              )}
                            >
                              {epic.key} - {epic.fields.summary}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={handleEpicSync}
                      disabled={
                        isEpicSyncing || isSyncing || !selectedEpicForSync
                      }
                      className="min-w-[100px]"
                    >
                      <RefreshCw
                        className={`mr-2 h-4 w-4 ${isEpicSyncing ? 'animate-spin' : ''}`}
                      />
                      {isEpicSyncing ? '동기화 중...' : '동기화'}
                    </Button>
                  </div>

                  {/* 구 HMG 링크 마이그레이션 버튼 (마이그레이션 완료로 숨김) */}
                  {/* <div className="pt-3 border-t space-y-2">
                    <Button
                      onClick={handleMigrateOldHmgLinks}
                      disabled={isSyncing}
                      variant="outline"
                      className="w-full"
                    >
                      <RefreshCw className="mr-2 h-4 w-4" />구 HMG 링크 → 신 HMG
                      링크 변환
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      구 Jira 링크를 신 Jira 링크로 일괄 변경합니다
                    </p>
                  </div> */}
                </div>
              </div>

              {/* 정적 분석 */}
              <div className="border-t pt-6">
                <h3 className="text-sm font-semibold mb-4">정적 분석</h3>

                <div className="space-y-3">
                  <label className="text-sm font-medium">
                    Black Duck / SonarQube
                  </label>
                  <p className="text-xs text-muted-foreground -mt-1">
                    선택한 프로젝트의 정적 분석 결과를 한 번에 확인합니다
                  </p>

                  <div className="flex gap-2">
                    <Select
                      value={staticAnalysisProject}
                      onValueChange={handleStaticAnalysisProjectChange}
                      disabled={isStaticAnalysisRunning}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="프로젝트 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="groupware">groupware</SelectItem>
                        <SelectItem value="hmg-board">
                          hmg-board (HB)
                        </SelectItem>
                        <SelectItem value="cpo">cpo</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button
                      onClick={handleRunStaticAnalysis}
                      disabled={
                        !isStaticAnalysisReady || isStaticAnalysisRunning
                      }
                      className="min-w-[100px]"
                    >
                      <RefreshCw
                        className={`mr-2 h-4 w-4 ${isStaticAnalysisRunning ? 'animate-spin' : ''}`}
                      />
                      {isStaticAnalysisRunning ? '실행 중...' : '실행'}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Right: Result Area */}
          <Card className="flex h-full flex-col overflow-hidden">
            <CardHeader>
              <CardTitle>결과 영역</CardTitle>
              <CardDescription>실시간 로그 및 실행 결과</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 p-0 overflow-hidden">
              <ScrollArea ref={resultScrollRef} className="h-full px-6 pb-6">
                <div className="space-y-3 font-mono text-sm leading-relaxed">
                  {/* 정적 분석 결과 (Black Duck) */}
                  {Object.keys(staticAnalysisResults).length > 0 && (
                    <>
                      <div className="text-muted-foreground opacity-50">
                        ─────────────────────────────────
                      </div>
                      <div className="font-semibold text-foreground">
                        🔎 정적 분석 결과
                      </div>

                      <div className="space-y-3 font-sans">
                        {Object.entries(staticAnalysisResults).map(
                          ([projectKey, result]) => {
                            const blackduck = result.blackduck;
                            if (!blackduck) return null;

                            const categories =
                              blackduck.riskProfile?.raw?.categories ?? {};
                            const license = categories.LICENSE ?? {};
                            const vuln = categories.VULNERABILITY ?? {};

                            const licenseCritical = license.CRITICAL ?? 0;
                            const licenseHigh = license.HIGH ?? 0;
                            const vulnCritical = vuln.CRITICAL ?? 0;
                            const vulnHigh = vuln.HIGH ?? 0;

                            const totalActionTargets =
                              licenseCritical +
                              licenseHigh +
                              vulnCritical +
                              vulnHigh;

                            const badgeClass =
                              totalActionTargets > 0
                                ? 'text-red-700 bg-red-50 border-red-200'
                                : 'text-green-700 bg-green-50 border-green-200';

                            const highlightCount = (value: number) =>
                              value > 0
                                ? 'text-red-700 font-semibold'
                                : 'text-muted-foreground';

                            return (
                              <div
                                key={projectKey}
                                className="p-4 bg-muted/30 rounded-lg border space-y-2"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="font-semibold">
                                      Black Duck ·{' '}
                                      {projectKey === 'hmg-board'
                                        ? 'HB'
                                        : projectKey}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {blackduck.project?.name ?? '-'} ·{' '}
                                      {blackduck.version?.name ?? '-'}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      Scan:{' '}
                                      {blackduck.scan?.scannedAt
                                        ? new Date(
                                            blackduck.scan.scannedAt
                                          ).toLocaleString('ko-KR')
                                        : '-'}
                                    </div>
                                  </div>
                                  <div
                                    className={`text-xs font-semibold px-2 py-1 rounded border whitespace-nowrap ${badgeClass}`}
                                  >
                                    조치 대상 {totalActionTargets}
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  <div className="text-sm">
                                    <div className="font-medium">LICENSE</div>
                                    <div className="text-xs text-muted-foreground">
                                      <span
                                        className={highlightCount(
                                          licenseCritical
                                        )}
                                      >
                                        CRITICAL {licenseCritical}
                                      </span>
                                      <span className="text-muted-foreground">
                                        {' '}
                                        ·{' '}
                                      </span>
                                      <span
                                        className={highlightCount(licenseHigh)}
                                      >
                                        HIGH {licenseHigh}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="text-sm">
                                    <div className="font-medium">
                                      VULNERABILITY
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      <span
                                        className={highlightCount(vulnCritical)}
                                      >
                                        CRITICAL {vulnCritical}
                                      </span>
                                      <span className="text-muted-foreground">
                                        {' '}
                                        ·{' '}
                                      </span>
                                      <span
                                        className={highlightCount(vulnHigh)}
                                      >
                                        HIGH {vulnHigh}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {blackduck.project?.url && (
                                  <div className="pt-1 flex justify-end">
                                    <Button variant="outline" size="sm" asChild>
                                      <a
                                        href={blackduck.project.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                        조치하러 가기
                                      </a>
                                    </Button>
                                  </div>
                                )}
                              </div>
                            );
                          }
                        )}

                        {Object.entries(staticAnalysisResults).map(
                          ([projectKey, result]) => {
                            const sonarqube = result.sonarqube;
                            if (!sonarqube) return null;

                            const failed = (sonarqube.conditions ?? []).filter(
                              (c) => c.status && c.status !== 'OK'
                            );

                            return (
                              <div
                                key={`${projectKey}-sonarqube`}
                                className="p-4 bg-muted/30 rounded-lg border space-y-2"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="font-semibold">
                                      SonarQube ·{' '}
                                      {projectKey === 'hmg-board'
                                        ? 'HB'
                                        : projectKey}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {sonarqube.projectKey}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      Scan:{' '}
                                      {sonarqube.analysisDate
                                        ? new Date(
                                            sonarqube.analysisDate
                                          ).toLocaleString('ko-KR')
                                        : '-'}
                                    </div>
                                  </div>
                                  <div
                                    className={`text-xs font-semibold px-2 py-1 rounded border whitespace-nowrap ${
                                      sonarqube.ok
                                        ? 'text-green-700 bg-green-50 border-green-200'
                                        : 'text-red-700 bg-red-50 border-red-200'
                                    }`}
                                  >
                                    {sonarqube.qualityGateStatus}
                                  </div>
                                </div>

                                {failed.length > 0 && (
                                  <div className="text-xs text-muted-foreground space-y-1">
                                    {failed.slice(0, 5).map((c, idx) => (
                                      <div
                                        key={idx}
                                        className="flex items-center justify-between gap-3"
                                      >
                                        <span className="truncate">
                                          {c.metricKey ?? 'metric'}:{' '}
                                          {c.actualValue ?? '-'}
                                        </span>
                                        <span className="text-red-700 font-semibold">
                                          {c.status}
                                        </span>
                                      </div>
                                    ))}
                                    {failed.length > 5 && (
                                      <div>... (총 {failed.length}개)</div>
                                    )}
                                  </div>
                                )}

                                {(sonarqube.projectUrl ||
                                  sonarqube.baseUrl) && (
                                  <div className="pt-1 flex justify-end">
                                    <Button variant="outline" size="sm" asChild>
                                      <a
                                        href={
                                          sonarqube.projectUrl ||
                                          sonarqube.baseUrl
                                        }
                                        target="_blank"
                                        rel="noopener noreferrer"
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                        조치하러 가기
                                      </a>
                                    </Button>
                                  </div>
                                )}
                              </div>
                            );
                          }
                        )}
                      </div>
                    </>
                  )}

                  {syncLogs.length === 0 &&
                  Object.keys(staticAnalysisResults).length === 0 &&
                  !isSyncing &&
                  !isEpicSyncing &&
                  !isStaticAnalysisRunning ? (
                    <>
                      <div className="text-muted-foreground">
                        <span className="text-green-500">[00:00:00]</span>{' '}
                        시스템 준비 완료...
                      </div>
                      <div className="text-muted-foreground">
                        <span className="text-blue-500">[00:00:01]</span> 작업
                        대기 중...
                      </div>
                      <div className="text-muted-foreground opacity-50">
                        ─────────────────────────────────
                      </div>
                      <div className="text-muted-foreground italic">
                        담당자를 선택하고 동기화 유형을 선택한 후
                        &ldquo;동기화&rdquo; 버튼을 클릭하세요
                      </div>
                    </>
                  ) : (
                    <>
                      {syncLogs.map((log, idx) => (
                        <div
                          key={idx}
                          className={`${
                            log.level === 'success'
                              ? 'text-green-600'
                              : log.level === 'error'
                                ? 'text-red-600'
                                : log.level === 'warning'
                                  ? 'text-yellow-600'
                                  : 'text-blue-600'
                          }`}
                        >
                          <span className="text-muted-foreground">
                            [{log.timestamp}]
                          </span>{' '}
                          <span className="whitespace-pre-wrap">
                            {emphasizeLogMessage(log.message)}
                          </span>
                        </div>
                      ))}

                      {/* 동기화 완료 후 결과 링크 */}
                      {syncSummary && syncSummary.results.length > 0 && (
                        <>
                          <div className="text-muted-foreground opacity-50 my-4">
                            ━━━━━━━━━━━━━━━━━━━━━━━━
                          </div>
                          <div className="font-semibold text-foreground mb-2">
                            📊 동기화 결과
                          </div>
                          {/* 통계 요약 */}
                          <div className="mb-4 p-4 bg-muted/30 rounded-lg border border-muted space-y-2 font-sans text-sm">
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">
                                필드 동기화
                              </span>
                              <span className="font-bold text-base">
                                {syncSummary.totalUpdated}개
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">
                                신규 생성
                              </span>
                              <span className="font-bold text-base text-green-600">
                                {syncSummary.totalCreated}개
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">
                                동기화 실패
                              </span>
                              <span className="font-bold text-base text-red-600">
                                {syncSummary.totalFailed}개
                              </span>
                            </div>
                          </div>
                          <div className="text-sm text-muted-foreground mb-2 font-semibold">
                            상세 결과
                          </div>
                          <div className="space-y-1">
                            {syncSummary.results.map((result, idx) => (
                              <div
                                key={idx}
                                className="flex items-center gap-2"
                              >
                                <span
                                  className={
                                    result.success
                                      ? 'text-green-600'
                                      : 'text-red-600'
                                  }
                                >
                                  {result.success ? '✓' : '✗'}
                                </span>
                                <a
                                  href={`${JIRA_ENDPOINTS.IGNITE}/browse/${result.fehgKey}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline inline-flex items-center gap-1"
                                >
                                  {result.fehgKey}
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                                <span className="text-muted-foreground">→</span>
                                {result.targetKey ? (
                                  <>
                                    <a
                                      href={`${
                                        result.targetProject === 'AUTOWAY'
                                          ? JIRA_ENDPOINTS.HMG
                                          : JIRA_ENDPOINTS.IGNITE
                                      }/browse/${result.targetKey}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-600 hover:underline inline-flex items-center gap-1"
                                    >
                                      {result.targetKey}
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                    {result.isNewlyCreated && (
                                      <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded">
                                        신규
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-red-600">
                                    생성 실패
                                  </span>
                                )}
                                {result.error && (
                                  <span className="text-xs text-red-500">
                                    ({result.error})
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
