/* eslint-disable no-param-reassign */
import getSnapshotSummary from '@jest/reporters/build/get_snapshot_summary';
import { getSummary } from '@jest/reporters/build/utils';
import {
  AssertionResult,
  SnapshotSummary as JestSnapshotSummary,
  Suite,
} from '@jest/test-result';
import { makeEmptyAggregatedTestResult } from '@jest/test-result/build/helpers';
import colors from 'ansi-colors';
import {
  formatExecError,
  formatResultsErrors,
  formatStackTrace,
} from 'jest-message-util';
// @ts-ignore
import useragent from 'ua-parser-js';

import { LogType } from '../Console';
import { SnapshotSummary } from '../snapshot/State';
import { Result } from '../types';

const isWindows = process.platform === 'win32';
const ARROW = ' \u203A ';

function getIcon(status: string) {
  if (status === 'failed') {
    return colors.red(isWindows ? '\u00D7' : '\u2715');
  }
  if (status === 'pending') {
    return colors.yellow('\u25CB');
  }
  if (status === 'todo') {
    return colors.magenta('\u270E');
  }
  return colors.green(isWindows ? '\u221A' : '\u2713');
}

const globalConfig = {
  rootDir: process.cwd(),
  testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
};

type SnapshotResolver = (suiteName: string, browserName: string) => string;

export type Options = {
  write: (log: string) => void;
  verbose?: boolean;
  numBrowsers?: number;
  processError: (error: string | Error) => Promise<string>;
  snapshotResolver: SnapshotResolver;
};

export type LogEntry = { message: string; type: LogType; origin: string };

const suiteKey = (suite: string, browser: any) => `${suite}--${browser.name}`;

export default class Printer {
  private testCount = new Map<string, number>();

  private printed = new WeakSet<any>();

  private root: Suite = { suites: [], tests: [], title: '' };

  private numPassedTests = 0;

  private numFailedTests = 0;

  private numSkippedTests = 0;

  private numTodoTests = 0;

  private passedSuites = new Set<string>();

  private failedSuites = new Set<string>();

  private skippedSuites = new Set<string>();

  private rootSuitesDone = new Map<string, { suite: string; browser: any }>();

  private rootSuitesRunning = new Map<
    string,
    { suite: string; browser: any }
  >();

  private startTime: number = Date.now();

  private write: (log: string) => void;

  private snapshotResolver: SnapshotResolver;

  private verbose: boolean;

  private numBrowsers: number;

  results = new Set<Result>();

  private logs = new Set<LogEntry>();

  private processError: (error: string | Error) => Promise<string>;

  // status: Status;

  clear = '';

  constructor({
    write,
    verbose,
    numBrowsers,
    snapshotResolver,
    processError,
  }: Options) {
    this.write = write;
    this.numBrowsers = numBrowsers || 1;
    this.verbose = verbose || false;
    this.snapshotResolver = snapshotResolver;
    this.processError = processError;

    // this.status = new Status(() => {
    //   this.clearStatus();
    //   this.printStatus();
    // });
  }

  private isSuiteComplete(items: Suite): boolean {
    const isCompleted = items.tests.every(
      (t) => this.testCount.get(t.fullName) === this.numBrowsers,
    );

    return isCompleted && items.suites.every((s) => this.isSuiteComplete(s));
  }

  runStart() {
    this.root = { suites: [], tests: [], title: '' };
    this.testCount.clear();
    this.results.clear();
    this.logs.clear();

    this.numFailedTests = 0;
    this.numSkippedTests = 0;
    this.numTodoTests = 0;
    this.numPassedTests = 0;

    // this are sets for easy deduping seen suites when counting
    this.passedSuites.clear();
    this.failedSuites.clear();
    this.skippedSuites.clear();

    this.rootSuitesDone.clear();
    this.rootSuitesRunning.clear();

    this.startTime = Date.now();
    this.clear = '';

    // this.status.runStarted();
  }

  runFinished() {
    // this.status.runFinished();
  }

  clearStatus() {
    if (!this.clear) return;

    this.write(this.clear);
    this.clear = '';
  }

  addRootSuite(suite: string, browser: any) {
    const key = suiteKey(suite, browser);

    if (this.rootSuitesDone.has(key)) return;

    this.rootSuitesRunning.set(key, { suite, browser });

    this.printStatus();
  }

  rootSuiteFinished(suite: string, browser: any) {
    const key = suiteKey(suite, browser);

    this.rootSuitesRunning.delete(key);
    this.rootSuitesDone.set(key, { suite, browser });

    this.printStatus();
  }

  addTestResult(testResult: Result) {
    const { assertionResult } = testResult;
    const rootSuite = assertionResult.ancestorTitles[0]!;
    let targetSuite = this.root;

    // Find the target suite for this test,
    // creating nested suites as necessary.
    for (const title of assertionResult.ancestorTitles) {
      let matchingSuite = targetSuite.suites.find((s) => s.title === title);
      if (!matchingSuite) {
        matchingSuite = { suites: [], tests: [], title };
        targetSuite.suites.push(matchingSuite);
      }
      targetSuite = matchingSuite;
    }
    targetSuite.tests.push(assertionResult);

    switch (assertionResult.status) {
      case 'skipped':
        this.numSkippedTests++;
        this.skippedSuites.add(rootSuite);
        break;
      case 'todo':
        this.numTodoTests++;
        break;
      case 'failed':
        this.numFailedTests++;
        this.failedSuites.add(rootSuite);
        break;
      default:
        this.numPassedTests++;
        this.passedSuites.add(rootSuite);
    }

    this.results.add(testResult);

    const count = (this.testCount.get(assertionResult.fullName) ?? 0) + 1;

    this.testCount.set(assertionResult.fullName, count);

    // if (count === this.numBrowsers) {
    //   this.printSuite(this.root);
    // }
  }

  addLog(log: LogEntry) {
    this.logs.add(log);
  }

  browserDisplayName(karmaBrowser: any) {
    const { browser } = useragent(karmaBrowser.fullName);

    const start = `${colors.bold(browser.name)} ${colors.dim(
      browser.version ?? '',
    )}`.trim();

    return start;
  }

  private getHeader(
    status: 'fail' | 'pass' | 'running',
    message: string,
    browser?: any,
  ) {
    let prefix = '';

    if (status === 'fail') prefix = colors.inverse.bold.red(' FAIL ');
    if (status === 'pass') prefix = colors.inverse.bold.green(' PASS ');
    if (status === 'running') prefix = colors.inverse.bold.yellow(' RUN ');

    if (browser && this.numBrowsers > 1)
      prefix += ` ${colors.reset.inverse.white(
        ` ${this.browserDisplayName(browser)} `,
      )}`;

    return `${prefix} ${message}`;
  }

  printHeader(
    status: 'fail' | 'pass' | 'running',
    message: string,
    browser?: any,
  ) {
    return this.getHeader(status, message, browser);
  }

  printLine(str?: string, indentLevel?: number) {
    const indentation = '  '.repeat(indentLevel || 0);
    this.write(`${indentation + (str || '')}\n`);
  }

  printMsg(str: string) {
    const isPrinted = !!this.clear;

    this.clearStatus();
    this.write(str);
    if (isPrinted) this.printStatus();
  }

  async printError(err: string) {
    const error = await this.processError(err);

    this.write(formatExecError(error, globalConfig, { noStackTrace: false }));
  }

  printStatus() {
    // console.log('clear', this.clear, height);
    let count = 0;

    let content = this.clear;
    this.rootSuitesDone.forEach(({ suite, browser }) => {
      count++;
      content += `${this.getHeader(
        this.failedSuites.has(suite) ? 'fail' : 'pass',
        suite,
        browser,
      )}\n`;
    });

    if (this.rootSuitesRunning.size && this.rootSuitesDone.size) {
      content += '\n';
      count++;
    }
    this.rootSuitesRunning.forEach(({ suite, browser }) => {
      count++;
      content += `${this.getHeader('running', suite, browser)}\n`;
    });

    this.write(`${this.clear}${content}\n`);

    this.clear = '\r\x1B[K\r\x1B[1A'.repeat(count);
  }

  private printTest(test: AssertionResult, indentLevel: number) {
    if (this.printed.has(test)) return;
    const status = getIcon(test.status);
    const time = test.duration ? ` (${test.duration.toFixed(0)}ms)` : '';
    this.printLine(`${status} ${colors.dim(test.title + time)}`, indentLevel);
    this.printed.add(test);
  }

  private printTests(tests: Array<AssertionResult>, indentLevel: number) {
    if (this.verbose) {
      tests.forEach((test) => this.printTest(test, indentLevel));
    } else {
      // XXX: what is this even doing
      const summedTests = tests.reduce<{
        pending: Array<AssertionResult>;
        todo: Array<AssertionResult>;
      }>(
        (result, test) => {
          if (this.printed.has(test)) return result;

          if (test.status === 'pending') {
            result.pending.push(test);
          } else if (test.status === 'todo') {
            result.todo.push(test);
          } else {
            this.printTest(test, indentLevel);
          }

          return result;
        },
        { pending: [], todo: [] },
      );

      if (summedTests.pending.length > 0) {
        summedTests.pending.forEach(this.printTodoOrPendingTest(indentLevel));
      }

      if (summedTests.todo.length > 0) {
        summedTests.todo.forEach(this.printTodoOrPendingTest(indentLevel));
      }
    }
  }

  private printTodoOrPendingTest(indentLevel: number) {
    return (test: AssertionResult): void => {
      const printedTestStatus =
        test.status === 'pending' ? 'skipped' : test.status;

      const text = colors.dim(`${printedTestStatus} ${test.title}`);
      this.printLine(`${getIcon(test.status)} ${text}`, indentLevel);
      this.printed.add(test);
    };
  }

  private printSuite(suite: Suite, indentLevel = 0) {
    if (!this.isSuiteComplete(suite)) return;

    if (suite.title && !this.printed.has(suite)) {
      this.printLine(suite.title, indentLevel);
      this.printed.add(suite);
    }

    this.printTests(suite.tests, indentLevel + 1);

    suite.suites.forEach((s) => this.printSuite(s, indentLevel + 1));
  }

  async printFailures() {
    const errs = await Promise.all(
      Array.from(this.results, async (err) => {
        err.assertionResult.failureMessages = await Promise.all(
          err.assertionResult.failureMessages.map((msg) =>
            this.processError(msg),
          ),
        );
        return err.assertionResult;
      }),
    );

    this.write(`\n${colors.bold('Summary of all failing tests')}\n`);

    this.write(
      formatResultsErrors(errs, globalConfig, { noStackTrace: false }) || '',
    );
  }

  async printSummary(snapshotState: Record<string, SnapshotSummary>) {
    const width = process.stdout.columns!;
    const emptyResult = makeEmptyAggregatedTestResult();

    const { snapshot } = emptyResult;
    for (const [browser, browserSnapState] of Object.entries(snapshotState)) {
      const resolver = (name: string) => this.snapshotResolver(name, browser);

      if (!snapshot.didUpdate) snapshot.didUpdate = !!browserSnapState.updated;

      snapshot.total += browserSnapState.total;
      snapshot.added += browserSnapState.added;
      snapshot.matched += browserSnapState.matched;
      snapshot.unchecked += browserSnapState.unchecked;

      snapshot.filesAdded += browserSnapState.suitesAdded;
      snapshot.filesRemoved += browserSnapState.suitesRemoved;
      snapshot.filesRemovedList.push(
        ...browserSnapState.suitesRemovedList.map(resolver),
      );

      snapshot.uncheckedKeysByFile.push(
        ...browserSnapState.uncheckedKeysBySuite.map((f) => ({
          ...f,
          filePath: resolver(f.suite),
        })),
      );
    }

    const summary = getSummary(
      {
        ...emptyResult,

        numFailedTests: this.numFailedTests,
        numPendingTests: this.numSkippedTests,
        numTodoTests: this.numTodoTests,
        numTotalTests: this.results.size,

        numPassedTests: this.numPassedTests,
        numFailedTestSuites: this.failedSuites.size,
        numPassedTestSuites: this.passedSuites.size,
        numTotalTestSuites: this.root.suites.length,
        startTime: this.startTime,
        snapshot,
      },
      { width },
    );

    try {
      this.printSnapshotSummary(snapshot);
    } catch (err) {
      console.error(err);
    }

    await this.printConsole();

    this.write(`\n${summary}\n`);
  }

  async printConsole() {
    const TITLE_INDENT = this.verbose ? '  ' : '    ';
    const CONSOLE_INDENT = `${TITLE_INDENT}  `;

    const logs = await Promise.all(
      Array.from(this.logs, async (entry) => {
        // need to do the object version here b/c there is no message on the origin
        const origin = await this.processError({ stack: entry.origin } as any);
        // console.log(origin, entry.origin);
        return { ...entry, origin };
      }),
    );

    const combined = logs.reduce((output, { type, message, origin }) => {
      message = message
        .split(/\n/)
        .map((line) => CONSOLE_INDENT + line)
        .join('\n');

      let typeMessage = `console.${type}`;
      let noStackTrace = true;
      let noCodeFrame = true;

      if (type === 'warn') {
        message = colors.yellow(message);
        typeMessage = colors.yellow(typeMessage);
        noStackTrace = false;
        noCodeFrame = false;
      } else if (type === 'error') {
        message = colors.red(message);
        typeMessage = colors.red(typeMessage);
        noStackTrace = false;
        noCodeFrame = false;
      }

      const formattedStackTrace = origin
        ? formatStackTrace(origin, globalConfig, {
            noCodeFrame,
            noStackTrace,
          })
        : '';

      return `${
        output + TITLE_INDENT + colors.dim(typeMessage)
      }\n${message.trimRight()}\n${colors.dim(
        formattedStackTrace.trimRight(),
      )}\n\n`;
    }, '');

    this.write(`\n${combined}\n`);
  }

  printSnapshotSummary(snapshots: JestSnapshotSummary) {
    if (this.numBrowsers > 1) {
      this.write('\nSkipping snapshot update for multiple browsers\n');
      return;
    }
    if (
      snapshots.added ||
      snapshots.unmatched ||
      snapshots.updated ||
      snapshots.filesRemoved
    ) {
      const snapshotSummary = getSnapshotSummary(
        snapshots,
        globalConfig as any,
        'press u',
      );
      this.write('\n');
      snapshotSummary.forEach((l) => this.write(`${l}\n`));
    }
  }

  printWatchPrompt() {
    // readline.clearLine(process.stdout, 0);
    // readline.cursorTo(process.stdout, 0);

    this.write(`
${colors.bold('Watch Usage')}
${colors.dim(` ${ARROW} Press`)} q ${colors.dim('to quit.')}
${colors.dim(` ${ARROW} Press`)} a ${colors.dim('to run all tests.')}
${colors.dim(` ${ARROW} Press`)} u ${colors.dim('to update snapshots.')}

`);
  }
}
