import { describe, expect, test } from '@jest/globals';
import { buildCodeCheckInput } from '../../../../dist/agent-skills/code-check/entry.js';
import { executeGB50011CodeCheckDomain } from '../../../../dist/agent-skills/code-check/gb50011/entry.js';

describe('buildCodeCheckInput', () => {
  test('prefers postprocessed artifact context over raw analysis summary', () => {
    const input = buildCodeCheckInput({
      traceId: 'trace-1',
      designCode: 'GB50017',
      model: { elements: [{ id: 'E1' }] },
      analysis: { success: true },
      analysisParameters: {},
      postprocessedResult: {
        utilizationByElement: { E1: 0.92 },
        controllingCases: { E1: 'LC2' },
      },
    });

    expect(input.context.utilizationByElement).toEqual({ E1: 0.92 });
  });

  test('extracts utilization from analysis result data', () => {
    const input = buildCodeCheckInput({
      traceId: 'trace-analysis-util',
      designCode: 'GB50010',
      model: { elements: [{ id: 'C1' }] },
      analysis: {
        success: true,
        data: {
          utilizationByElement: { C1: { '轴压比': 0.88 } },
        },
      },
      analysisParameters: {},
    });

    expect(input.context.utilizationByElement).toEqual({ C1: { '轴压比': 0.88 } });
  });

  test('lets explicit analysis parameters override analysis result utilization', () => {
    const input = buildCodeCheckInput({
      traceId: 'trace-parameter-util',
      designCode: 'GB50010',
      model: { elements: [{ id: 'C1' }] },
      analysis: {
        success: true,
        data: {
          utilizationByElement: { C1: { '轴压比': 0.88 } },
        },
      },
      analysisParameters: {
        utilizationByElement: { C1: { '轴压比': 0.76 } },
      },
    });

    expect(input.context.utilizationByElement).toEqual({ C1: { '轴压比': 0.76 } });
  });

  test('adds a global seismic check element for GB50011 seismic analysis results', () => {
    const analysis = {
      success: true,
      data: {
        analysisMode: 'opensees_china_seismic_workflow',
        workflowInputMode: 'structured_seismic_workflow',
        summary: { maxStoryDriftRatio: 0.0012 },
        envelope: { maxBaseShear: 1200, maxStoryDriftRatio: 0.0012 },
        modelSummary: { nodeCount: 6, elementCount: 6, storyCount: 2 },
        designBasis: { structuralFamily: 'concrete-frame' },
        methodDecision: { selectedMethods: ['response_spectrum', 'time_history'] },
        regularityAssessment: { classification: 'regular' },
        overLimitReview: { reviewRequired: true, status: 'approved', approvalId: 'SZ-REVIEW-2026-001' },
        directionResults: [{ direction: 'x' }, { direction: 'y' }],
        elasticPlasticTimeHistory: { finalCompliance: { status: 'pass' } },
        seismicDesignActions: { status: 'computed', memberForceCount: 6 },
        gravityDesignActions: { status: 'computed', memberForceCount: 6 },
        memberDesignActionCombinations: { status: 'computed', caseCount: 1 },
        missingCapabilities: ['gb50011.elasticDriftLimitForStructuralFamily'],
        capabilityAssessment: {
          structuralFamily: 'bridge',
          finalComplianceSupported: false,
        },
        timeHistory: {
          records: [{ baseShearRatioToResponseSpectrum: 0.72 }],
          averageBaseShear: 900,
          baseShearCheck: { responseSpectrumBaseShear: 1000 },
        },
      },
    };
    const input = buildCodeCheckInput({
      traceId: 'trace-seismic',
      designCode: 'GB/T 50011-2010-2024',
      model: { elements: [{ id: 'C1' }] },
      analysis,
      analysisParameters: {},
    });

    expect(input.elements).toEqual(['__global_seismic__', 'C1']);
    expect(input.context.analysisSummary).toMatchObject({
      success: true,
      analysisMode: 'opensees_china_seismic_workflow',
      workflowInputMode: 'structured_seismic_workflow',
      summary: { maxStoryDriftRatio: 0.0012 },
      envelope: { maxBaseShear: 1200, maxStoryDriftRatio: 0.0012 },
      modelSummary: { nodeCount: 6, elementCount: 6, storyCount: 2 },
      designBasis: { structuralFamily: 'concrete-frame' },
      methodDecision: { selectedMethods: ['response_spectrum', 'time_history'] },
      regularityAssessment: { classification: 'regular' },
      overLimitReview: { reviewRequired: true, status: 'approved', approvalId: 'SZ-REVIEW-2026-001' },
      directionResults: [{ direction: 'x' }, { direction: 'y' }],
      elasticPlasticTimeHistory: { finalCompliance: { status: 'pass' } },
      seismicDesignActions: { status: 'computed', memberForceCount: 6 },
      gravityDesignActions: { status: 'computed', memberForceCount: 6 },
      memberDesignActionCombinations: { status: 'computed', caseCount: 1 },
      missingCapabilities: ['gb50011.elasticDriftLimitForStructuralFamily'],
      capabilityAssessment: {
        structuralFamily: 'bridge',
        finalComplianceSupported: false,
      },
    });
    expect(input.context).toMatchObject({
      code: 'GB50011',
      displayCode: 'GB 55002-2021 + GB/T 50011-2010 (2024 partial revision)',
      codeVersion: 'v2-global-seismic-gb55002-gbt50011-2024',
      codeBasis: [
        {
          code: 'GB 55002-2021',
          role: 'mandatory-seismic-general-code',
          effectiveDate: '2022-01-01',
        },
        {
          code: 'GB/T 50011-2010',
          role: 'seismic-design-standard',
          edition: '2024 partial revision',
          effectiveDate: '2024-08-01',
        },
      ],
    });
  });

  test('passes GB50011 code-basis metadata through the domain entry', async () => {
    let capturedPayload;
    const engineClient = {
      async post(_path, payload) {
        capturedPayload = payload;
        return { data: { status: 'success' } };
      },
    };

    await executeGB50011CodeCheckDomain(engineClient, {
      modelId: 'trace-gb50011-entry',
      code: 'GB/T 50011-2010-2024',
      elements: ['__global_seismic__'],
      context: {
        analysisSummary: {},
        utilizationByElement: {},
      },
    });

    expect(capturedPayload).toMatchObject({
      model_id: 'trace-gb50011-entry',
      code: 'GB50011',
      context: {
        code: 'GB50011',
        displayCode: 'GB 55002-2021 + GB/T 50011-2010 (2024 partial revision)',
        codeVersion: 'v2-global-seismic-gb55002-gbt50011-2024',
      },
    });
    expect(capturedPayload.context.codeBasis).toHaveLength(2);
  });

  test('accepts unwrapped seismic analysis data when adding the global GB50011 check', () => {
    const input = buildCodeCheckInput({
      traceId: 'trace-seismic-unwrapped',
      designCode: 'GB50011',
      model: { elements: [{ id: 'C1' }] },
      analysis: {
        analysisMode: 'opensees_china_seismic_workflow',
        workflowInputMode: 'legacy_compatibility_parameters',
        summary: { maxStoryDriftRatio: 0.0012 },
        envelope: { maxStoryDriftRatio: 0.0012 },
        designBasis: { structuralFamily: 'concrete-frame' },
        methodDecision: { selectedMethods: ['response_spectrum'] },
      },
      analysisParameters: {},
    });

    expect(input.elements).toEqual(['__global_seismic__', 'C1']);
    expect(input.context.analysisSummary).toMatchObject({
      analysisMode: 'opensees_china_seismic_workflow',
      workflowInputMode: 'legacy_compatibility_parameters',
      summary: { maxStoryDriftRatio: 0.0012 },
    });
  });

  test('enriches element context with material and section records', () => {
    const input = buildCodeCheckInput({
      traceId: 'trace-2',
      designCode: 'GB50010',
      model: {
        materials: [
          { id: '1', grade: 'C30', category: 'concrete' },
          { id: '2', grade: 'HRB400', category: 'rebar' },
        ],
        sections: [
          { id: '1', name: '400X400', type: 'rectangular', purpose: 'column' },
          { id: '2', name: '250X600', type: 'rectangular', purpose: 'beam' },
        ],
        elements: [
          {
            id: 'C1',
            type: 'column',
            nodes: ['N0_0', 'N1_0'],
            material: '1',
            section: '1',
            concrete_grade: 'C30',
            rebar_grade: 'HRB400',
            story: 'F1',
          },
        ],
      },
      analysis: { success: true },
      analysisParameters: {},
    });

    expect(input.elements).toEqual(['C1']);
    expect(input.context.elementContextById.C1).toMatchObject({
      id: 'C1',
      type: 'column',
      materialId: '1',
      sectionId: '1',
      material: { id: '1', grade: 'C30', category: 'concrete' },
      section: { id: '1', name: '400X400', type: 'rectangular', purpose: 'column' },
      concreteGrade: 'C30',
      rebarGrade: 'HRB400',
      story: 'F1',
    });
  });

  test('builds beam element data with section dimensions and node length', () => {
    const input = buildCodeCheckInput({
      traceId: 'trace-beam-geometry',
      designCode: 'GB50011',
      model: {
        nodes: [
          { id: 'N1', x: 0, y: 0, z: 3.6 },
          { id: 'N2', x: 6, y: 0, z: 3.6 },
        ],
        materials: [
          { id: '1', grade: 'C30', category: 'concrete' },
        ],
        sections: [
          { id: '1', name: '250X600', type: 'rectangular', width: 250, height: 600, properties: { A: 0.15 } },
        ],
        elements: [
          { id: 'B1', type: 'beam', nodes: ['N1', 'N2'], material: '1', section: '1' },
        ],
      },
      analysis: { success: true },
      analysisParameters: {},
    });

    expect(input.context.elementData.B1).toMatchObject({
      type: 'beam',
      length: 6000,
      material: { id: '1', grade: 'C30', category: 'concrete' },
      section: {
        A: 150000,
        width: 250,
        height: 600,
      },
    });
  });

  test('preserves concrete seismic wall data for GB50011 detailing checks', () => {
    const reinforcement = {
      wall: {
        doubleLayer: true,
        tie: { diameterMm: 6, spacingMm: 500 },
        verticalDistributed: { diameterMm: 10, spacingMm: 180, layerCount: 2 },
        horizontalDistributed: { diameterMm: 10, spacingMm: 180, layerCount: 2 },
      },
    };
    const wallData = {
      isBottomStrengthenedZone: true,
      hasEndColumn: true,
    };
    const boundaryElement = {
      id: 'left-edge',
      longitudinal: { ratioPercent: 1.1, diameterMm: 16 },
      minLongitudinalRatioPercent: 1.0,
      hoop: { diameterMm: 8, spacingMm: 100 },
      maxHoopSpacingMm: 120,
    };
    const boundaryElements = [
      {
        id: 'right-edge',
        longitudinal: { ratioPercent: 1.0, diameterMm: 16 },
        hoop: { diameterMm: 8, spacingMm: 110 },
      },
    ];
    const input = buildCodeCheckInput({
      traceId: 'trace-wall-detailing',
      designCode: 'GB50011',
      model: {
        nodes: [
          { id: 'B1', x: 0, y: 0, z: 0 },
          { id: 'T1', x: 0, y: 0, z: 3.6 },
        ],
        materials: [
          { id: '1', grade: 'C40', category: 'concrete' },
        ],
        sections: [
          {
            id: 'WSEC',
            name: 'SW200X3000',
            type: 'rectangular',
            purpose: 'wall',
            thickness: 200,
            properties: { wallLength: 3.0, G: 12500 },
          },
        ],
        elements: [
          {
            id: 'W1',
            type: 'wall',
            nodes: ['B1', 'T1'],
            material: '1',
            section: 'WSEC',
            seismic_grade: 'second',
            storyHeightMm: 3600,
            reinforcement,
            wallData,
            boundaryElement,
            boundaryElements,
          },
        ],
      },
      analysis: { success: true },
      analysisParameters: {},
    });

    expect(input.context.elementData.W1).toMatchObject({
      type: 'wall',
      length: 3600,
      seismicGrade: 'second',
      storyHeightMm: 3600,
      reinforcement,
      wallData,
      boundaryElement,
      boundaryElements,
      material: { id: '1', grade: 'C40', category: 'concrete' },
      section: {
        A: 0,
        thickness: 200,
        wallThickness: 200,
        wallLength: 3,
        properties: { wallLength: 3.0, G: 12500 },
      },
    });
    expect(input.context.elementContextById.W1).toMatchObject({
      type: 'wall',
      seismicGrade: 'second',
      storyHeightMm: 3600,
      reinforcement,
      wallData,
      boundaryElement,
      boundaryElements,
    });
  });

  test('preserves structured GB50011 member detailing and capacity data', () => {
    const seismicCapacity = {
      shearCapacityKN: 650,
      momentCapacityKNm: 320,
    };
    const capacityDesign = {
      strongShearWeakBending: {
        capacityDesignShearDemandKN: 520,
        designShearCapacityKN: 650,
      },
    };
    const shearCompression = {
      shearDemandKN: 420,
      coefficient: 0.2,
    };
    const jointCore = {
      shearDemandKN: 300,
      shearCapacityKN: 500,
    };
    const flatBeam = {
      isFlatBeam: true,
      castInPlaceFloor: true,
    };
    const input = buildCodeCheckInput({
      traceId: 'trace-gb50011-member-detailing',
      designCode: 'GB50011',
      model: {
        materials: [
          { id: '1', grade: 'C30', category: 'concrete' },
        ],
        sections: [
          {
            id: 'BSEC',
            name: '300X600',
            type: 'rectangular',
            width: 300,
            height: 600,
            extra: {
              jointCore,
              flatBeam,
              columnPosition: 'corner',
            },
          },
        ],
        elements: [
          {
            id: 'B1',
            type: 'beam',
            material: '1',
            section: 'BSEC',
            seismicCapacity,
            metadata: {
              capacityDesign,
              shearCompression,
              jointData: { columnDimensionMm: 500 },
              columnCategory: 'frame-supported',
            },
          },
        ],
      },
      analysis: { success: true },
      analysisParameters: {},
    });

    expect(input.context.elementData.B1).toMatchObject({
      seismicCapacity,
      capacityDesign,
      shearCompression,
      jointCore,
      jointData: { columnDimensionMm: 500 },
      flatBeam,
      columnPosition: 'corner',
      columnCategory: 'frame-supported',
    });
    expect(input.context.elementContextById.B1).toMatchObject({
      seismicCapacity,
      capacityDesign,
      shearCompression,
      jointData: { columnDimensionMm: 500 },
      columnCategory: 'frame-supported',
    });
  });

  test('preserves steel seismic detailing data for GB50011 member checks', () => {
    const steelSeismicDetailing = {
      memberSlendernessRatio: 70,
      memberSlendernessLimit: 120,
    };
    const widthThickness = {
      flangeWidthThicknessRatio: 9,
      flangeWidthThicknessLimit: 10,
    };
    const steelDetailing = {
      braceSlendernessRatio: 80,
      braceSlendernessLimit: 120,
    };
    const input = buildCodeCheckInput({
      traceId: 'trace-steel-detailing',
      designCode: 'GB50011',
      model: {
        materials: [
          { id: 'S355', grade: 'Q355', category: 'steel' },
        ],
        sections: [
          {
            id: 'H400',
            name: 'H400X200',
            type: 'H',
            properties: { A: 0.012, Iy: 0.00032, Iz: 0.00008 },
            extra: {
              widthThickness,
            },
          },
        ],
        elements: [
          {
            id: 'SB1',
            type: 'steel-beam',
            material: 'S355',
            section: 'H400',
            steelSeismicDetailing,
            extra: {
              steelDetailing,
            },
            metadata: {
              seismicDetailing: {
                webHeightThicknessRatio: 60,
                webHeightThicknessLimit: 72,
              },
            },
          },
        ],
      },
      analysis: { success: true },
      analysisParameters: {},
    });

    expect(input.context.elementData.SB1).toMatchObject({
      type: 'steel-beam',
      material: { id: 'S355', grade: 'Q355', category: 'steel' },
      steelSeismicDetailing,
      widthThickness,
    });
    expect(input.context.elementData.SB1.section.extra).toMatchObject({
      widthThickness,
    });
    expect(input.context.elementContextById.SB1).toMatchObject({
      steelSeismicDetailing,
      steelDetailing,
      seismicDetailing: {
        webHeightThicknessRatio: 60,
        webHeightThicknessLimit: 72,
      },
    });
  });

  test('preserves pre-resolved material and section objects', () => {
    const material = { id: 'm1', grade: 'C30', category: 'concrete' };
    const section = { id: 's1', name: '500X250', type: 'rectangular' };
    const input = buildCodeCheckInput({
      traceId: 'trace-3',
      designCode: 'GB50010',
      model: {
        elements: [
          {
            id: 'B1',
            type: 'beam',
            material,
            section,
          },
        ],
      },
      analysis: { success: true },
      analysisParameters: {},
    });

    expect(input.context.elementContextById.B1).toMatchObject({
      material,
      section,
    });
  });
});
