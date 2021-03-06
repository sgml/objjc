"use strict";

const
    captureStream = require("capture-stream"),
    cli = require("../../lib/cli.js"),
    exists = require("path-exists").sync,
    expect = require("code").expect,
    fs = require("fs"),
    issueHandler = require("acorn-issue-handler"),
    path = require("path"),
    Runner = require("../../lib/runner"),
    stripColor = require("chalk").stripColor;

exports.run = function(args, options)
{
    options = options || {};
    options.parseOptions = Object.assign({}, options.parseOptions, { slice: 0 });

    const
        restoreStdout = captureStream(process.stdout),
        restoreStderr = captureStream(process.stderr),
        exitCode = cli.run(args, options),
        output = stripColor(restoreStderr(true) + restoreStdout(true));

    return { exitCode, output };
};

exports.readFixture = name =>
{
    const parsed = path.parse(name);

    if (parsed.ext === ".map")
    {
        parsed.name = path.basename(parsed.name, path.extname(parsed.name));
        parsed.ext = ".js.map";
    }

    const fixturePath = path.join("test/fixtures", parsed.dir, parsed.base);

    expect(exists(fixturePath)).to.be.true();

    return fs.readFileSync(fixturePath, "utf8");
};

function compiledSourceOrFixture(source, file, options)
{
    const defaultOptions = {
        acornOptions: {},
        maxErrors: 0,
        quiet: true,
        warnings: ["all"]
    };

    options = Object.assign({}, defaultOptions, options);

    let restore;

    try
    {
        if (options.captureStdout)
        {
            restore = captureStream(process.stdout);
            options.reporter = issueHandler.StandardReporter;
        }
        else
            options.reporter = issueHandler.SilentReporter;

        delete options.captureStdout;

        const runner = new Runner(options);
        let stdout;

        runner.compileFileOrSource(file, source);

        if (restore)
            stdout = restore(true);
        else
            stdout = "";

        const compiler = runner.compiler;

        return {
            code: compiler ? compiler.code : "",
            map: (compiler && options.sourceMap) ? compiler.sourceMap : "",
            stdout
        };
    }
    catch (ex)
    {
        if (restore)
            restore();

        console.error(ex.message);
    }

    return { code: "", map: "", stdout: "" };
}

exports.compiledFixture = (file, options) =>
{
    if (path.extname(file) === "")
        file += ".j";

    let sourcePath = file;

    if (!path.isAbsolute(file))
        sourcePath = path.resolve(path.join("test", "fixtures", file));

    if (!exists(sourcePath))
        throw new Error("No such fixture: " + sourcePath);

    let source = "";

    if (options && options.stdin)
    {
        source = fs.readFileSync(sourcePath, "utf8");
        sourcePath = "<stdin>";
        delete options.stdin;
    }

    return compiledSourceOrFixture(source, sourcePath, options);
};

exports.compiledSource = (source, options) => compiledSourceOrFixture(source, "", options);

// This maps fixture names to options passed to the cli
const cliFixtureArgs = {
    "ast-0.txt": ["--ast", "0"],
    "ast-2.txt": ["--ast", "2"],
    "environment-browser.js": ["--environment", "browser"],
    "environment-node.js": ["--environment", "node"],
    "max-errors-1.j": ["--max-errors", "1"],
    "max-errors-0.j": ["--max-errors", "0"],
    "warnings-all.j": ["--warnings", "all"],
    "warnings-none.j": ["--warnings", "none"],
    "warnings-enable-disable.j": ["--warnings", "+parameter-types,no-implicit-globals"],
    "warnings-list.j": ["--warnings", "debugger,unknown-types"],
    "format-name.js": ["--format", "cappuccino"],
    "format-name.json.js": ["--format", "cappuccino.json"],
    "format-path.js": ["--format", "test/fixtures/cli/code/src/test-format.json"],
    "format-bad.js": ["--format", "foo"],
    "objj-scope.j": ["--objj-scope", "false"],
    "quiet.j": ["--source-map", "--quiet"],
    "stdin.js": "-"
};

exports.convertIssuePathsToPosix = text => text.replace(
    /^\s*[^:]+/gm,
    match => match.replace(/\\/g, "/")
);

/*
 * Strip out all but the filename from the 'sourceFile' property of AST nodes.
 */
function stripASTPaths(result)
{
    result.output = result.output.replace(
        /("sourceFile":\s*)"([^"]+)"/g,
        // Because the AST is JSON, paths are quoted and thus backslashes are doubled
        (match, key, filePath) =>
        {
            // First convert paths to Posix
            filePath = filePath.replace(/\\\\/g, "/");

            return `${key}"${path.basename(filePath)}"`;
        }
    );
}

exports.compiledCliFixture = function(filePath)
{
    const filename = path.basename(filePath);
    let args = cliFixtureArgs[filename];

    if (!args)
    {
        // Use the filename without extension as the arg
        const arg = path.basename(filename, path.extname(filename));

        args = ["--" + arg];
    }
    else if (!Array.isArray(args))
        args = [args];

    let options,
        result;

    if (filename.startsWith("stdin."))
    {
        result = fs.readFileSync(filePath, "utf-8");
        options = { stdin: result };
    }
    else
        args.push(filePath);

    result = exports.run(args, options);

    if (filePath.includes("/exceptions/"))
        result.output = exports.convertIssuePathsToPosix(result.output);
    else if (filename.startsWith("ast-"))
        stripASTPaths(result);

    return result;
};

exports.compiledMiscCliFixture = function(test, alwaysCompile)
{
    let args = ["--" + test];

    const dest = `test/fixtures/cli/misc/${test}.txt`;

    if (alwaysCompile || !exists(dest))
    {
        const result = exports.run(args);

        return {
            exitCode: result.exitCode,
            output: result.output,
            dest
        };
    }

    return null;
};

function makeDescribe(description, should, fixture)
{
    describe(description, () =>
    {
        it(should, () =>
        {
            expect(exports.compiledFixture(fixture).code).to.equal(exports.readFixture(fixture + ".js"));
        });
    });
}

exports.makeDescribes = (data, pathPrefix) =>
{
    for (let i = 0; i < data.length; i++)
    {
        const
            info = data[i],
            description = info[0],
            should = info[1],
            filename = info[2];

        let fixture = path.join(pathPrefix, filename ? filename : description.replace(" ", "-"));

        if (!exists(path.join("test", "fixtures", fixture)))
        {
            console.warn("No such fixture: %s", fixture);
            continue;
        }

        makeDescribe(description, should, fixture);
    }
};

const compilerOptions = {
    "no-types": { typeSignatures: false },
    "no-method-names": { methodNames: false }
};

exports.setCompilerOptions = (options, file) =>
{
    options = Object.assign({}, options);

    const filename = path.basename(file, path.extname(file));
    let specialOptions = compilerOptions[filename];

    if (!specialOptions)
    {
        if (filename.startsWith("inline-") || filename.endsWith("-inline"))
            specialOptions = { inlineMsgSend: true };
    }

    return Object.assign(options, specialOptions);
};
