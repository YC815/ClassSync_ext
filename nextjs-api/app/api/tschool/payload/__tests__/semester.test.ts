/**
 * 學期計算功能單元測試
 *
 * 測試台灣學制的民國學年度學期計算邏輯
 */

import {
  getSemester,
  getSemesterInfo,
  calculateAcademicWeek,
  getNextMondayISO,
  getCurrentSemesterWeek,
  isDateInSemester,
  getTestCases
} from '../semester-utils';

describe('學期計算工具函數', () => {
  describe('getSemester', () => {
    it('應該正確計算第一學期（8-12月）', () => {
      // 8月1日開始第一學期
      expect(getSemester(new Date('2024-08-01'))).toBe('113-1');
      expect(getSemester(new Date('2024-09-15'))).toBe('113-1');
      expect(getSemester(new Date('2024-12-31'))).toBe('113-1');

      // 2025年
      expect(getSemester(new Date('2025-08-01'))).toBe('114-1');
      expect(getSemester(new Date('2025-09-10'))).toBe('114-1');
    });

    it('應該正確計算第一學期（1月）', () => {
      // 1月屬於前一學年度的第一學期
      expect(getSemester(new Date('2025-01-01'))).toBe('113-1');
      expect(getSemester(new Date('2025-01-31'))).toBe('113-1');
      expect(getSemester(new Date('2026-01-20'))).toBe('114-1');
    });

    it('應該正確計算第二學期（2-7月）', () => {
      // 2月開始第二學期
      expect(getSemester(new Date('2025-02-01'))).toBe('113-2');
      expect(getSemester(new Date('2025-03-15'))).toBe('113-2');
      expect(getSemester(new Date('2025-07-31'))).toBe('113-2');

      // 2026年
      expect(getSemester(new Date('2026-03-05'))).toBe('114-2');
    });

    it('應該通過所有預定義測試案例', () => {
      const testCases = [
        { date: '2025-01-20', expected: '113-1' },
        { date: '2025-02-15', expected: '113-2' },
        { date: '2025-09-10', expected: '114-1' },
        { date: '2026-03-05', expected: '114-2' },
        { date: '2024-08-01', expected: '113-1' },
        { date: '2024-12-31', expected: '113-1' },
        { date: '2025-07-31', expected: '113-2' },
      ];

      testCases.forEach(({ date, expected }) => {
        const result = getSemester(new Date(date));
        expect(result).toBe(expected);
      });
    });
  });

  describe('getSemesterInfo', () => {
    it('應該正確解析第一學期資訊', () => {
      const info = getSemesterInfo('114-1');

      expect(info.academicYear).toBe(114);
      expect(info.semesterNumber).toBe(1);
      expect(info.startDate).toEqual(new Date(2025, 7, 1)); // 2025年8月1日
      expect(info.endDate).toEqual(new Date(2026, 0, 31)); // 2026年1月31日
    });

    it('應該正確解析第二學期資訊', () => {
      const info = getSemesterInfo('113-2');

      expect(info.academicYear).toBe(113);
      expect(info.semesterNumber).toBe(2);
      expect(info.startDate).toEqual(new Date(2024, 1, 1)); // 2024年2月1日
      expect(info.endDate).toEqual(new Date(2024, 6, 31)); // 2024年7月31日
    });

    it('應該拋出錯誤當學期格式不正確時', () => {
      expect(() => getSemesterInfo('114' as any)).toThrow();
      expect(() => getSemesterInfo('114-3' as any)).toThrow();
      expect(() => getSemesterInfo('abc-1' as any)).toThrow();
    });
  });

  describe('calculateAcademicWeek', () => {
    it('應該正確計算第一學期的週次', () => {
      // 第一學期從8月1日開始
      const semester = '114-1';

      // 第1週（8月1日）
      expect(calculateAcademicWeek(new Date('2025-08-01'), semester)).toBe(1);

      // 第2週（8月8日）
      expect(calculateAcademicWeek(new Date('2025-08-08'), semester)).toBe(2);

      // 第10週（10月初）
      expect(calculateAcademicWeek(new Date('2025-10-03'), semester)).toBe(10);
    });

    it('應該正確計算第二學期的週次', () => {
      // 第二學期從2月1日開始
      const semester = '114-2';

      // 第1週（2月1日）
      expect(calculateAcademicWeek(new Date('2025-02-01'), semester)).toBe(1);

      // 第4週（2月底）
      expect(calculateAcademicWeek(new Date('2025-02-22'), semester)).toBe(4);
    });

    it('應該自動計算學期當未提供時', () => {
      // 不提供學期參數，應自動計算
      const week1 = calculateAcademicWeek(new Date('2025-09-15')); // 114-1
      const week2 = calculateAcademicWeek(new Date('2025-03-15')); // 113-2

      expect(typeof week1).toBe('number');
      expect(typeof week2).toBe('number');
      expect(week1).toBeGreaterThan(0);
      expect(week2).toBeGreaterThan(0);
    });
  });

  describe('getNextMondayISO', () => {
    it('應該正確計算下週一', () => {
      // 從週三（2025-09-17）計算下週一（2025-09-22）
      expect(getNextMondayISO(new Date('2025-09-17'))).toBe('2025-09-22');

      // 從週日（2025-09-21）計算下週一（2025-09-22）
      expect(getNextMondayISO(new Date('2025-09-21'))).toBe('2025-09-22');

      // 從週一（2025-09-15）計算下週一（2025-09-22）
      expect(getNextMondayISO(new Date('2025-09-15'))).toBe('2025-09-22');
    });

    it('應該回傳正確的ISO日期格式', () => {
      const result = getNextMondayISO(new Date('2025-09-17'));
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('isDateInSemester', () => {
    it('應該正確判斷日期是否在學期範圍內', () => {
      // 第一學期（8月1日-1月31日）
      expect(isDateInSemester(new Date('2025-08-15'), '114-1')).toBe(true);
      expect(isDateInSemester(new Date('2025-12-25'), '114-1')).toBe(true);
      expect(isDateInSemester(new Date('2026-01-15'), '114-1')).toBe(true);
      expect(isDateInSemester(new Date('2025-07-31'), '114-1')).toBe(false);
      expect(isDateInSemester(new Date('2026-02-01'), '114-1')).toBe(false);

      // 第二學期（2月1日-7月31日）
      expect(isDateInSemester(new Date('2025-02-15'), '114-2')).toBe(true);
      expect(isDateInSemester(new Date('2025-07-15'), '114-2')).toBe(true);
      expect(isDateInSemester(new Date('2025-01-31'), '114-2')).toBe(false);
      expect(isDateInSemester(new Date('2025-08-01'), '114-2')).toBe(false);
    });
  });

  describe('getCurrentSemesterWeek', () => {
    it('應該回傳完整的學期週次資訊', () => {
      const info = getCurrentSemesterWeek(new Date('2025-09-15'));

      expect(info).toHaveProperty('semester');
      expect(info).toHaveProperty('week');
      expect(info).toHaveProperty('weekStartISO');
      expect(info).toHaveProperty('semesterInfo');
      expect(info).toHaveProperty('isInSemester');

      expect(typeof info.semester).toBe('string');
      expect(typeof info.week).toBe('number');
      expect(typeof info.weekStartISO).toBe('string');
      expect(typeof info.isInSemester).toBe('boolean');
    });

    it('應該計算正確的學期和週次', () => {
      // 2025年9月15日應該是114-1學期
      const info = getCurrentSemesterWeek(new Date('2025-09-15'));

      expect(info.semester).toBe('114-1');
      expect(info.week).toBeGreaterThan(0);
      expect(info.weekStartISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('getTestCases', () => {
    it('應該回傳所有測試案例的結果', () => {
      const results = getTestCases();

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      results.forEach(result => {
        expect(result).toHaveProperty('date');
        expect(result).toHaveProperty('expected');
        expect(result).toHaveProperty('result');
        expect(result).toHaveProperty('passed');
        expect(result).toHaveProperty('semesterInfo');
        expect(typeof result.passed).toBe('boolean');
      });
    });

    it('所有測試案例都應該通過', () => {
      const results = getTestCases();
      const failedTests = results.filter(result => !result.passed);

      expect(failedTests).toEqual([]);
    });
  });

  describe('邊界情況測試', () => {
    it('應該正確處理學期邊界日期', () => {
      // 7月31日應該是第二學期的最後一天
      expect(getSemester(new Date('2025-07-31'))).toBe('113-2');

      // 8月1日應該是第一學期的第一天
      expect(getSemester(new Date('2025-08-01'))).toBe('114-1');

      // 1月31日應該是第一學期的最後一天
      expect(getSemester(new Date('2025-01-31'))).toBe('113-1');

      // 2月1日應該是第二學期的第一天
      expect(getSemester(new Date('2025-02-01'))).toBe('113-2');
    });

    it('應該正確處理跨年情況', () => {
      // 同一學年度跨年的情況
      expect(getSemester(new Date('2024-12-31'))).toBe('113-1');
      expect(getSemester(new Date('2025-01-01'))).toBe('113-1');
    });

    it('應該正確處理閏年', () => {
      // 2024年是閏年，測試2月29日
      const leapYearDate = new Date('2024-02-29');
      const semester = getSemester(leapYearDate);
      expect(semester).toBe('112-2');
    });
  });

  describe('錯誤處理', () => {
    it('應該處理無效的日期輸入', () => {
      expect(() => getSemester(new Date('invalid-date'))).toThrow();
    });

    it('應該處理無效的學期格式', () => {
      expect(() => getSemesterInfo('invalid' as any)).toThrow();
      expect(() => getSemesterInfo('999-9' as any)).toThrow();
    });
  });
});