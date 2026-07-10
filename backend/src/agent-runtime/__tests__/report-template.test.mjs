import { describe, expect, test } from '@jest/globals';

const baseInput = {
  message: '执行中国抗震分析',
  analysisType: 'seismic',
  analysisSuccess: true,
  codeCheckText: '未执行规范校核',
  summary: '分析类型 seismic，分析成功。',
  keyMetrics: {
    maxBaseShear: 123.4,
    maxStoryDriftRatio: 0.0012,
    modalMassParticipationRatio: 0.91,
  },
  clauseTraceability: [],
  controllingCases: {},
  visualizationHints: {},
  analysis: {
    success: true,
    data: {
      workflowInputMode: 'structured_seismic_workflow',
      designBasis: {
        codeBasis: [
          { code: 'GB 55002-2021' },
          { code: 'GB/T 50011-2010' },
          {
            code: 'GB 18306-2015',
            standardStatus: 'current',
            lastReviewDate: '2021-12-31',
            lastReviewConclusion: 'continue_valid',
            revisionPlan: {
              planNo: '20260055-Q-419',
              status: 'drafting',
            },
          },
        ],
        region: '北京',
        intensity: 8,
        accelerationG: 0.2,
        earthquakeLevel: 'frequent',
        fortificationCategory: 'key',
        fortificationCategoryLabel: {
          zh: '重点设防类',
          en: 'key fortification category',
        },
        fortificationCategoryCodeClass: 'B',
        seismicMeasureIntensity: 9,
        seismicSafetyEvaluationRequired: false,
        seismicSafetyEvaluationProvided: false,
        seismicGrade: 2,
        seismicGradeSource: 'designRequirements.seismicGrade',
        designGroup: '2',
        siteCategory: 'III',
        characteristicPeriod: 0.55,
        alphaMax: 0.16,
        sourceTrace: [
          {
            field: 'accelerationG',
            value: 0.2,
            source: 'designBasis.siteSeismic.accelerationG',
            sourceType: 'user',
            assumed: false,
          },
          {
            field: 'alphaMax',
            value: 0.16,
            source: 'GB/T 50011-2010(2024).alphaMaxByAcceleration',
            sourceType: 'code',
            assumed: false,
            note: 'derived from accelerationG=0.2 and earthquakeLevel=frequent',
          },
        ],
        groundMotionZonation: {
          source: 'user-provided-gb18306-zonation',
          regionCode: 'EX-001',
        },
      },
      methodDecision: {
        selectedMethods: ['response_spectrum', 'time_history'],
        reasons: ['Structured design requirements explicitly request supplementary elastic time-history analysis.'],
      },
      overLimitReview: {
        reviewRequired: true,
        reviewType: 'over_limit_high_rise',
        status: 'approved',
        approvalId: 'SZ-REVIEW-2026-001',
      },
      responseSpectrum: {
        modalCombination: 'cqc',
        minimumStoryShearAdjustment: {
          status: 'adjusted',
          maxAdjustmentFactor: 1.18,
        },
        longPeriodSpecialStudyAdvisory: {
          status: 'advisory_only',
          governingMode: {
            modeNumber: 1,
            period: 6.5,
            advisoryAlpha: 0.032,
          },
        },
      },
      responseSpectrumFinalCompliance: {
        status: 'pass',
        driftRatio: 0.0012,
        limitDriftRatio: 0.00181818,
        utilization: 0.66,
      },
      elasticStoryDriftFinalCompliance: {
        status: 'pass',
        driftRatio: 0.0014,
        limitDriftRatio: 0.00181818,
        utilization: 0.77,
      },
      timeHistory: {
        catalogSelection: {
          source: 'local_ground_motion_catalog',
          catalogIds: ['LC-01', 'LC-02', 'LC-03'],
        },
        spectrumMatch: {
          maxScaleFactor: 1.4,
          targetPeriod: 0.8,
          modalSpectrumAverageMinRatio: 0.65,
          averageModalSpectrumMinRatioToTarget: 0.92,
          modalSpectrumAverageOk: true,
        },
        controllingStory: {
          story: '0-3.6m',
          driftRatio: 0.0014,
          record: 'LC-02',
        },
        combinationSummary: {
          timeHistoryStatistic: 'envelope',
          governingSource: 'time_history_envelope',
          combinedBaseShear: 140.5,
        },
      },
      directionResults: [
        {
          direction: 'x',
          timeHistory: {
            records: [
              { baseShearRatioToResponseSpectrum: 0.7 },
              { baseShearRatioToResponseSpectrum: 0.82 },
              { baseShearRatioToResponseSpectrum: 0.9 },
            ],
            combinationSummary: {
              combinedBaseShear: 140.5,
            },
          },
        },
        {
          direction: 'y',
          timeHistory: {
            records: [
              { baseShearRatioToResponseSpectrum: 0.72 },
              { baseShearRatioToResponseSpectrum: 0.84 },
              { baseShearRatioToResponseSpectrum: 0.91 },
            ],
            combinationSummary: {
              combinedBaseShear: 135.2,
            },
          },
        },
      ],
      groundMotionRequirement: {
        required: true,
        requiredCount: 3,
        providedCount: 3,
        missingCount: 0,
        status: 'satisfied',
      },
      summary: {
        nodeCount: 6,
        elementCount: 6,
        storyCount: 2,
        directions: ['x', 'y'],
        groundMotionRecordCount: 3,
        minStoryShearWeightRatio: 0.052,
        periodSpecialStudyRequired: true,
      },
      periodRangeAssessment: {
        requiresSpecialStudy: true,
        maxModePeriodSec: 6.5,
        maxCodeSpectrumPeriodSec: 6.0,
      },
    },
  },
};

describe('default report template seismic section', () => {
  test('renders Chinese seismic design basis and key metrics', async () => {
    const { buildDefaultReportNarrative } = await import('../../../dist/agent-runtime/report-template.js');

    const markdown = buildDefaultReportNarrative({ ...baseInput, locale: 'zh' });

    expect(markdown).toContain('## 抗震专项');
    expect(markdown).toContain('GB 55002-2021');
    expect(markdown).toContain('GB/T 50011-2010');
    expect(markdown).toContain('GB 18306 状态: 现行，复审 2021-12-31: 继续有效；修订计划 20260055-Q-419 正在起草，未作为当前正式设计依据');
    expect(markdown).toContain('抗震参数取值来源');
    expect(markdown).toContain('accelerationG: 0.2 / 来源 designBasis.siteSeismic.accelerationG / 类型 user');
    expect(markdown).toContain('alphaMax: 0.16 / 来源 GB/T 50011-2010(2024).alphaMaxByAcceleration / 类型 code');
    expect(markdown).toContain('流程输入模式: 结构化 seismicWorkflow');
    expect(markdown).toContain('地区: 北京');
    expect(markdown).toContain('地震动参数区划: user-provided-gb18306-zonation，地区码 EX-001');
    expect(markdown).toContain('模型规模: 节点 6，单元 6，楼层 2');
    expect(markdown).toContain('分析方向: x, y');
    expect(markdown).toContain('振型组合: cqc');
    expect(markdown).toContain('设计基本地震加速度: 0.2');
    expect(markdown).toContain('地震水准: frequent');
    expect(markdown).toContain('设防类别: 重点设防类（B类），抗震措施烈度 9，安评 不需要');
    expect(markdown).toContain('抗震等级: 2（来源: designRequirements.seismicGrade）');
    expect(markdown).toContain('地震波目录: local_ground_motion_catalog');
    expect(markdown).toContain('地震波编号: LC-01, LC-02, LC-03');
    expect(markdown).toContain('地震波需求: 需 3 条，已提供 3 条，缺少 0 条');
    expect(markdown).toContain('地震波谱适配: 最小平均谱比 0.92，限值 0.65，状态 true');
    expect(markdown).toContain('反应谱弹性层间位移角: pass，位移角 0.0012，限值 0.00181818，利用率 0.66');
    expect(markdown).toContain('弹性总包络层间位移角: pass，位移角 0.0014，限值 0.00181818，利用率 0.77');
    expect(markdown).toContain('长周期 advisory: 控制振型 1，周期 6.5 s，建议谱系数 0.032');
    expect(markdown).toContain('时程组合: envelope 与反应谱取大，控制来源 time_history_envelope，组合基底剪力 140.5');
    expect(markdown).toContain('方向时程摘要: x 3条，最小基底剪力比 0.7，组合基底剪力 140.5；y 3条，最小基底剪力比 0.72，组合基底剪力 135.2');
    expect(markdown).toContain('最大基底剪力: 123.4');
    expect(markdown).toContain('最大层间位移角: 0.0012');
    expect(markdown).toContain('弹性时程控制楼层: 0-3.6m，层间位移角 0.0014，地震波 LC-02');
    expect(markdown).toContain('最小楼层剪重比: 0.052');
    expect(markdown).toContain('楼层最小剪力调整: adjusted，最大系数 1.18');
    expect(markdown).toContain('超限/专项审查: over_limit_high_rise / 需要 / approved / SZ-REVIEW-2026-001');
  });

  test('renders English seismic design basis and key metrics', async () => {
    const { buildDefaultReportNarrative } = await import('../../../dist/agent-runtime/report-template.js');

    const markdown = buildDefaultReportNarrative({ ...baseInput, locale: 'en' });

    expect(markdown).toContain('## Seismic Design');
    expect(markdown).toContain('GB 55002-2021');
    expect(markdown).toContain('GB/T 50011-2010');
    expect(markdown).toContain('GB 18306 status: current, review 2021-12-31: continue valid; revision plan 20260055-Q-419 drafting, not used as current formal design basis');
    expect(markdown).toContain('Seismic parameter sources');
    expect(markdown).toContain('accelerationG: 0.2 / source designBasis.siteSeismic.accelerationG / type user');
    expect(markdown).toContain('alphaMax: 0.16 / source GB/T 50011-2010(2024).alphaMaxByAcceleration / type code');
    expect(markdown).toContain('Workflow input mode: structured seismicWorkflow');
    expect(markdown).toContain('Region: 北京');
    expect(markdown).toContain('Ground-motion zonation: user-provided-gb18306-zonation, region code EX-001');
    expect(markdown).toContain('Model scale: nodes 6, elements 6, stories 2');
    expect(markdown).toContain('Analysis directions: x, y');
    expect(markdown).toContain('Modal combination: cqc');
    expect(markdown).toContain('Design basic acceleration: 0.2');
    expect(markdown).toContain('Earthquake level: frequent');
    expect(markdown).toContain('Fortification category: key fortification category (Class B), seismic measure intensity 9, safety evaluation not required');
    expect(markdown).toContain('Seismic grade: 2 (source: designRequirements.seismicGrade)');
    expect(markdown).toContain('Ground-motion catalog: local_ground_motion_catalog');
    expect(markdown).toContain('Ground-motion requirement: required 3, provided 3, missing 0');
    expect(markdown).toContain('Ground-motion spectrum compatibility: min average spectrum ratio 0.92, limit 0.65, status true');
    expect(markdown).toContain('Response-spectrum elastic drift: pass, drift ratio 0.0012, limit 0.00181818, utilization 0.66');
    expect(markdown).toContain('Elastic envelope story drift: pass, drift ratio 0.0014, limit 0.00181818, utilization 0.77');
    expect(markdown).toContain('Long-period advisory: governing mode 1, period 6.5 s, advisory alpha 0.032');
    expect(markdown).toContain('Time-history combination: envelope versus response spectrum, governing source time_history_envelope, combined base shear 140.5');
    expect(markdown).toContain('Directional time-history summary: x 3 records, min base-shear ratio 0.7, combined base shear 140.5; y 3 records, min base-shear ratio 0.72, combined base shear 135.2');
    expect(markdown).toContain('Max base shear: 123.4');
    expect(markdown).toContain('Max story drift ratio: 0.0012');
    expect(markdown).toContain('Elastic time-history controlling story: 0-3.6m, drift ratio 0.0014, record LC-02');
    expect(markdown).toContain('Minimum story shear-weight ratio: 0.052');
    expect(markdown).toContain('Minimum story shear adjustment: adjusted, max factor 1.18');
    expect(markdown).toContain('Over-limit/special review: over_limit_high_rise / required / approved / SZ-REVIEW-2026-001');
  });

  test('marks preliminary seismic calculations when required inputs are missing', async () => {
    const { buildDefaultReportNarrative } = await import('../../../dist/agent-runtime/report-template.js');

    const markdown = buildDefaultReportNarrative({
      ...baseInput,
      locale: 'zh',
      analysis: {
        success: true,
        data: {
          ...baseInput.analysis.data,
          isPreliminary: true,
          missingInputs: ['designBasis.siteSeismic.designGroup'],
        },
      },
    });

    expect(markdown).toContain('计算状态: 预分析');
    expect(markdown).toContain('designBasis.siteSeismic.designGroup');
  });

  test('marks legacy compatibility seismic analysis as not a formal China seismic report', async () => {
    const { buildDefaultReportNarrative } = await import('../../../dist/agent-runtime/report-template.js');

    const markdown = buildDefaultReportNarrative({
      ...baseInput,
      locale: 'zh',
      analysis: {
        success: true,
        data: {
          ...baseInput.analysis.data,
          workflowInputMode: 'legacy_compatibility_parameters',
        },
      },
    });

    expect(markdown).toContain('流程输入模式: 旧参数兼容路径');
    expect(markdown).toContain('不能作为正式中国抗震计算书');
    expect(markdown).toContain('结构化 seismicWorkflow');
  });

  test('renders directional ground-motion total requirements', async () => {
    const { buildDefaultReportNarrative } = await import('../../../dist/agent-runtime/report-template.js');

    const markdown = buildDefaultReportNarrative({
      ...baseInput,
      locale: 'zh',
      analysis: {
        success: true,
        data: {
          ...baseInput.analysis.data,
          groundMotionRequirement: {
            required: true,
            requiredCount: 3,
            totalRequiredCount: 6,
            providedCount: 3,
            missingCount: 3,
            status: 'missing',
          },
        },
      },
    });

    expect(markdown).toContain('地震波需求: 每方向需 3 条，总需 6 条，已提供 3 条，缺少 3 条');
  });

  test('renders elastic-plastic story-shear model details', async () => {
    const { buildDefaultReportNarrative } = await import('../../../dist/agent-runtime/report-template.js');

    const markdown = buildDefaultReportNarrative({
      ...baseInput,
      locale: 'zh',
      analysis: {
        success: true,
        data: {
          ...baseInput.analysis.data,
          elasticPlasticTimeHistory: {
            status: 'estimated',
            modelScope: 'bilinear_story_shear_building',
            maxDriftRatio: 0.0031,
            fallbackElasticTimeHistoryExecuted: true,
            parameters: {
              storyCount: 2,
              yieldDriftLimitRatioText: '1/1000',
              yieldDriftLimitFamily: 'shear-wall / tube-in-tube / transfer-level family',
              yieldDriftIsFallback: false,
            },
            nonlinearModelAudit: {
              status: 'complete',
              materialModelCount: 1,
              memberPlasticHingeCount: 6,
            },
            records: [
              {
                name: 'GM1',
                storyResponses: [
                  { story: 'F1', maxDriftRatio: 0.0024 },
                  { story: 'F2', maxDriftRatio: 0.0031 },
                ],
              },
            ],
            finalCompliance: {
              status: 'pass',
              utilization: 0.155,
              performanceObjective: {
                name: 'life_safety',
                acceptanceDriftRatio: 0.015,
              },
            },
          },
        },
      },
    });

    expect(markdown).toContain('弹塑性时程模型: bilinear_story_shear_building，楼层 2');
    expect(markdown).toContain('弹塑性建议屈服位移角: 1/1000 / shear-wall / tube-in-tube / transfer-level family');
    expect(markdown).toContain('非线性模型输入审计: complete，材料模型 1，塑性铰 6');
    expect(markdown).toContain('弹塑性控制楼层: F2，层间位移角 0.0031');
    expect(markdown).toContain('弹塑性时程最终符合性: pass，利用率 0.155');
    expect(markdown).toContain('弹塑性性能目标: life_safety，限值 0.015');
  });

  test('renders elastic-plastic plastic-hinge controller details', async () => {
    const { buildDefaultReportNarrative } = await import('../../../dist/agent-runtime/report-template.js');

    const markdown = buildDefaultReportNarrative({
      ...baseInput,
      locale: 'zh',
      analysis: {
        success: true,
        data: {
          ...baseInput.analysis.data,
          elasticPlasticTimeHistory: {
            status: 'estimated',
            modelScope: 'member_end_rotational_plastic_hinges_2d',
            maxDriftRatio: 0.0031,
            fallbackElasticTimeHistoryExecuted: true,
            parameters: { hingeCount: 8 },
            nonlinearModelAudit: {
              status: 'complete',
              materialModelCount: 1,
              memberPlasticHingeCount: 8,
            },
            controllingHinge: {
              elementId: 'C1',
              end: 'i',
              ductility: 1.27,
            },
            finalCompliance: {
              status: 'pass',
              utilization: 0.155,
            },
          },
        },
      },
    });

    expect(markdown).toContain('弹塑性时程模型: member_end_rotational_plastic_hinges_2d，楼层 N/A');
    expect(markdown).toContain('弹塑性控制塑性铰: C1 i，延性 1.27');
  });

  test('renders pushover story-shear model details', async () => {
    const { buildDefaultReportNarrative } = await import('../../../dist/agent-runtime/report-template.js');

    const markdown = buildDefaultReportNarrative({
      ...baseInput,
      locale: 'zh',
      analysis: {
        success: true,
        data: {
          ...baseInput.analysis.data,
          pushover: {
            targetDisplacement: 0.02,
            maxRoofDisplacement: 0.02,
            capacityAssessment: {
              performancePoint: {
                roofDisplacementM: 0.018,
                driftRatio: 0.0039,
                source: 'secantCapacitySpectrumIteration',
              },
              capacitySpectrumIteration: {
                status: 'estimated',
                iterationCount: 6,
                secantPeriodSec: 0.72,
              },
            },
            nonlinearEstimate: {
              status: 'estimated',
              modelScope: 'bilinear_story_shear_building',
              parameters: {
                storyCount: 2,
                yieldDriftLimitRatioText: '1/250',
                yieldDriftLimitFamily: 'steel structure',
                yieldDriftIsFallback: false,
              },
              performancePoint: {
                roofDisplacementM: 0.02,
                driftRatio: 0.0043,
              },
              controllingStory: {
                story: 'F1',
                driftRatio: 0.0043,
              },
            },
            finalCompliance: {
              status: 'pass',
              utilization: 0.215,
              performanceObjective: {
                name: 'collapse_prevention',
                acceptanceDriftRatio: 0.012,
              },
            },
          },
        },
      },
    });

    expect(markdown).toContain('Pushover 弹塑性模型: bilinear_story_shear_building，楼层 2');
    expect(markdown).toContain('Pushover 建议屈服位移角: 1/250 / steel structure');
    expect(markdown).toContain('Pushover 容量谱迭代: estimated，迭代 6，周期 0.72 s');
    expect(markdown).toContain('Pushover 控制楼层: F1，层间位移角 0.0043');
    expect(markdown).toContain('Pushover 最终符合性: pass，利用率 0.215');
    expect(markdown).toContain('Pushover 性能目标: collapse_prevention，限值 0.012');
  });

  test('renders pushover plastic-hinge controller details', async () => {
    const { buildDefaultReportNarrative } = await import('../../../dist/agent-runtime/report-template.js');

    const markdown = buildDefaultReportNarrative({
      ...baseInput,
      locale: 'zh',
      analysis: {
        success: true,
        data: {
          ...baseInput.analysis.data,
          pushover: {
            targetDisplacement: 0.02,
            maxRoofDisplacement: 0.02,
            nonlinearEstimate: {
              status: 'estimated',
              modelScope: 'member_end_rotational_plastic_hinges_2d',
              parameters: { hingeCount: 8 },
              performancePoint: {
                roofDisplacementM: 0.02,
                driftRatio: 0.0043,
              },
              controllingHinge: {
                elementId: 'C1',
                end: 'i',
                ductility: 1.42,
              },
            },
            finalCompliance: {
              status: 'pass',
              utilization: 0.215,
            },
          },
        },
      },
    });

    expect(markdown).toContain('Pushover 弹塑性模型: member_end_rotational_plastic_hinges_2d，楼层 N/A');
    expect(markdown).toContain('Pushover 控制塑性铰: C1 i，延性 1.42');
  });

  test('renders seismic capability boundaries when final compliance is not fully supported', async () => {
    const { buildDefaultReportNarrative } = await import('../../../dist/agent-runtime/report-template.js');

    const markdown = buildDefaultReportNarrative({
      ...baseInput,
      locale: 'zh',
      analysis: {
        success: true,
        data: {
          ...baseInput.analysis.data,
          missingCapabilities: ['gb50011.elasticDriftLimitForStructuralFamily'],
          capabilityAssessment: {
            structuralFamily: 'bridge',
            finalComplianceSupported: false,
          },
        },
      },
    });

    expect(markdown).toContain('能力边界');
    expect(markdown).toContain('gb50011.elasticDriftLimitForStructuralFamily');
    expect(markdown).toContain('不能据此声明完整规范符合性');
  });

  test('renders vertical seismic action requirement when triggered', async () => {
    const { buildDefaultReportNarrative } = await import('../../../dist/agent-runtime/report-template.js');

    const markdown = buildDefaultReportNarrative({
      ...baseInput,
      locale: 'zh',
      analysis: {
        success: true,
        data: {
          ...baseInput.analysis.data,
          methodDecision: {
            ...baseInput.analysis.data.methodDecision,
            verticalSeismicRequired: true,
            verticalSeismicReasons: ['Intensity 8 or 9 with structured large-span flag requires vertical seismic action.'],
          },
          verticalSeismic: {
            status: 'computed',
            coefficient: 0.1,
            totalVerticalActionKN: 18,
            openSeesStatic: {
              memberForceCount: 6,
            },
          },
          missingCapabilities: ['gb50011.verticalSeismicMemberCapacityCheck'],
        },
      },
    });

    expect(markdown).toContain('竖向地震作用: 标准值 18 kN，系数 0.1，构件内力 6 个');
    expect(markdown).toContain('large-span');
    expect(markdown).toContain('gb50011.verticalSeismicMemberCapacityCheck');
  });

  test('renders special-system review reasons and capability boundary', async () => {
    const { buildDefaultReportNarrative } = await import('../../../dist/agent-runtime/report-template.js');

    const markdown = buildDefaultReportNarrative({
      ...baseInput,
      locale: 'zh',
      analysis: {
        success: true,
        data: {
          ...baseInput.analysis.data,
          methodDecision: {
            ...baseInput.analysis.data.methodDecision,
            specialSystemReviewRequired: true,
            specialSystemReasons: [
              'Structured workflow marks an isolation system; specialized isolation seismic analysis is required.',
              'Structured workflow marks an energy-dissipation system; specialized damping-device seismic analysis is required.',
            ],
          },
          specialSystemReview: {
            reviewRequired: true,
            systems: ['isolation', 'energy_dissipation'],
            missingInputs: ['isolationSystem.equivalentDampingRatio'],
            deviceCounts: {
              isolation: 2,
              energy_dissipation: 4,
            },
            checks: [{ item: '隔震层位移验收', status: 'pass' }],
            failedCheckCount: 0,
            isolationEquivalentLinearEstimate: {
              status: 'estimated',
              periodSec: 2.4,
              displacementDemandM: 0.08,
              displacementCapacityM: 0.12,
              finalCompliance: {
                status: 'pass',
              },
            },
            isolationLayerTimeHistoryEstimate: {
              status: 'estimated',
              periodSec: 2.35,
              controllingRecord: 'ISO-TH-1',
              maxDisplacementM: 0.072,
              maxBaseShearKN: 640,
              finalCompliance: {
                status: 'pass',
              },
            },
            energyDissipationEquivalentEstimate: {
              status: 'estimated',
              periodSec: 1.2,
              equivalentDampingRatio: 0.13,
              demandReductionRatio: 0.7,
              adjustedDisplacementDemandM: 0.028,
              deformationCapacityM: 0.06,
              finalCompliance: {
                status: 'pass',
              },
            },
            energyDissipationTimeHistoryEstimate: {
              status: 'estimated',
              periodSec: 1.18,
              controllingRecord: 'ED-TH-1',
              maxDeviceDeformationM: 0.031,
              maxDeviceForceKN: 820,
              finalCompliance: {
                status: 'pass',
              },
            },
          },
          missingCapabilities: [
            'gb50011.isolationSystemSpecialSeismicAnalysis',
            'gb50011.energyDissipationSystemSpecialSeismicAnalysis',
          ],
        },
      },
    });

    expect(markdown).toContain('专门体系复核');
    expect(markdown).toContain('专门体系审计');
    expect(markdown).toContain('隔震等效线性估算');
    expect(markdown).toContain('0.08 m');
    expect(markdown).toContain('隔震层 SDOF 时程估算');
    expect(markdown).toContain('ISO-TH-1');
    expect(markdown).toContain('消能减震等效阻尼估算');
    expect(markdown).toContain('0.028 m');
    expect(markdown).toContain('消能器 SDOF 时程估算');
    expect(markdown).toContain('ED-TH-1');
    expect(markdown).toContain('820 kN');
    expect(markdown).toContain('isolationSystem.equivalentDampingRatio');
    expect(markdown).toContain('isolation system');
    expect(markdown).toContain('energy-dissipation system');
    expect(markdown).toContain('gb50011.isolationSystemSpecialSeismicAnalysis');
    expect(markdown).toContain('gb50011.energyDissipationSystemSpecialSeismicAnalysis');
  });

  test('renders long-period special-study requirement', async () => {
    const { buildDefaultReportNarrative } = await import('../../../dist/agent-runtime/report-template.js');

    const markdown = buildDefaultReportNarrative({
      ...baseInput,
      locale: 'zh',
      analysis: {
        success: true,
        data: {
          ...baseInput.analysis.data,
          periodRangeAssessment: {
            requiresSpecialStudy: true,
            maxModePeriodSec: 6.5,
            maxCodeSpectrumPeriodSec: 6.0,
          },
          missingCapabilities: ['gb50011.responseSpectrumLongPeriodSpecialStudy'],
        },
      },
    });

    expect(markdown).toContain('长周期专项研究');
    expect(markdown).toContain('最大模态周期 6.5 s');
    expect(markdown).toContain('gb50011.responseSpectrumLongPeriodSpecialStudy');
  });

  test('includes specific code-check item names in clause traceability', async () => {
    const { buildDefaultReportNarrative } = await import('../../../dist/agent-runtime/report-template.js');

    const markdown = buildDefaultReportNarrative({
      ...baseInput,
      locale: 'zh',
      clauseTraceability: [{
        elementId: '__global_seismic__',
        check: '振型组合完整性校核',
        item: '振型参与质量系数',
        clause: 'GB/T 50011-2010(2024) 5.2.2',
        utilization: 0.9783,
        status: 'pass',
      }],
    });

    expect(markdown).toContain('振型组合完整性校核');
    expect(markdown).toContain('振型参与质量系数');
  });

  test('renders Chinese code-check summary with failed and not-applicable items', async () => {
    const { buildDefaultReportNarrative } = await import('../../../dist/agent-runtime/report-template.js');

    const markdown = buildDefaultReportNarrative({
      ...baseInput,
      locale: 'zh',
      codeCheck: {
        summary: {
          total: 4,
          passed: 2,
          failed: 1,
          warnings: 1,
          notApplicable: 1,
          maxUtilization: 9999,
          controllingElement: '__global_seismic__',
          controllingCheck: '抗震能力边界',
        },
        details: [{
          elementId: '__global_seismic__',
          checks: [{
            name: '整体抗震校核',
          items: [
            {
              item: '抗震能力边界',
              status: 'fail',
              utilization: 9999,
              clause: 'GB 55002-2021 + GB/T 50011-2010(2024)',
              message: 'Missing full-member nonlinear capability.',
            },
            {
              item: '地震波谱适配',
              status: 'warning',
              utilization: 0.91,
              clause: 'GB/T 50011-2010(2024) 5.1.2',
              message: 'Review selected records.',
            },
            {
              item: '竖向地震构件承载力',
              status: 'not_applicable',
              utilization: 0,
              message: 'Capacity data is unavailable.',
            },
            {
              item: '多遇地震弹性层间位移角',
              status: 'pass',
              utilization: 0.36,
              clause: 'GB/T 50011-2010(2024) 5.5.1',
            },
          ],
        }],
      }],
      },
    });

    expect(markdown).toContain('## 规范校核摘要');
    expect(markdown).toContain('汇总: 总数 4，通过 2，失败 1，警告 1，不适用/资料不足 1');
    expect(markdown).toContain('控制校核: 整体抗震流程 / 抗震能力边界 / 利用率 N/A');
    expect(markdown).toContain('### 规范校核结果表');
    expect(markdown).toContain('| 状态 | 构件/范围 | 校核 | 验算项 | 条文 | 利用率 | 说明 |');
    expect(markdown).toContain('| 未通过 | 整体抗震流程 | 整体抗震校核 | 抗震能力边界');
    expect(markdown).toContain('| 警告 | 整体抗震流程 | 整体抗震校核 | 地震波谱适配');
    expect(markdown).toContain('| 资料不足/不适用 | 整体抗震流程 | 整体抗震校核 | 竖向地震构件承载力');
    expect(markdown).toContain('| 通过 | 整体抗震流程 | 整体抗震校核 | 多遇地震弹性层间位移角');
    expect(markdown).toContain('失败或需关注项');
    expect(markdown).toContain('抗震能力边界');
    expect(markdown).toContain('竖向地震构件承载力');
    expect(markdown).toContain('Capacity data is unavailable.');
  });

  test('renders English code-check summary when all visible items pass', async () => {
    const { buildDefaultReportNarrative } = await import('../../../dist/agent-runtime/report-template.js');

    const markdown = buildDefaultReportNarrative({
      ...baseInput,
      locale: 'en',
      codeCheck: {
        summary: {
          total: 2,
          passed: 2,
          failed: 0,
          warnings: 0,
        },
        details: [{
          elementId: 'C1',
          checks: [{
            name: 'Seismic action combination',
            items: [{ item: 'member capacity', status: 'pass', utilization: 0.72 }],
          }],
        }],
      },
    });

    expect(markdown).toContain('## Code-Check Summary');
    expect(markdown).toContain('Summary: total 2, passed 2, failed 0, warnings 0');
    expect(markdown).toContain('### Code-Check Result Table');
    expect(markdown).toContain('| Status | Element/Scope | Check | Item | Clause | Utilization | Note |');
    expect(markdown).toContain('| pass | C1 | Seismic action combination | member capacity');
    expect(markdown).toContain('No failed or attention-required check items found.');
  });
});
