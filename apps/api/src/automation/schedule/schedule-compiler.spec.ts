import type { Schedule } from '@command-center/contracts';
import { compileSchedule } from './schedule-compiler';

describe('compileSchedule', () => {
  it('compiles a daily schedule', () => {
    expect(compileSchedule({ type: 'daily', time: '12:00' })).toBe('0 12 * * *');
    expect(compileSchedule({ type: 'daily', time: '09:05' })).toBe('5 9 * * *');
    expect(compileSchedule({ type: 'daily', time: '00:00' })).toBe('0 0 * * *');
    expect(compileSchedule({ type: 'daily', time: '23:59' })).toBe('59 23 * * *');
  });

  it('compiles weekly schedules, mapping ISO weekdays to cron (7 = Sunday -> 0)', () => {
    expect(compileSchedule({ type: 'weekly', time: '21:30', days: [1, 2, 3, 4, 5] })).toBe(
      '30 21 * * 1,2,3,4,5',
    );
    expect(compileSchedule({ type: 'weekly', time: '10:00', days: [6, 7] })).toBe('0 10 * * 0,6');
    expect(compileSchedule({ type: 'weekly', time: '08:15', days: [7] })).toBe('15 8 * * 0');
  });

  it('compiles equal descriptors to equal expressions (deterministic)', () => {
    const a = compileSchedule({ type: 'weekly', time: '08:00', days: [1, 3, 7] });
    const b = compileSchedule({ type: 'weekly', time: '08:00', days: [7, 3, 1] });
    expect(a).toBe(b);
  });

  it('compiles sub-hour intervals as minute steps', () => {
    expect(compileSchedule({ type: 'interval', everyMinutes: 5 })).toBe('*/5 * * * *');
    expect(compileSchedule({ type: 'interval', everyMinutes: 30 })).toBe('*/30 * * * *');
  });

  it('compiles hour-multiple intervals as hour steps', () => {
    expect(compileSchedule({ type: 'interval', everyMinutes: 60 })).toBe('0 * * * *');
    expect(compileSchedule({ type: 'interval', everyMinutes: 120 })).toBe('0 */2 * * *');
    expect(compileSchedule({ type: 'interval', everyMinutes: 720 })).toBe('0 */12 * * *');
  });

  it('throws on a malformed time (unreachable behind the contract schema)', () => {
    expect(() => compileSchedule({ type: 'daily', time: '25:00' } as Schedule)).toThrow(/25:00/);
    expect(() => compileSchedule({ type: 'daily', time: 'noon' } as Schedule)).toThrow(/noon/);
  });
});
