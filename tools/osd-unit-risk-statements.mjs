// Explicit audit of abaplint's statement registry. Do not derive the harmless
// set by subtracting unsafe kinds: an upstream addition must fail the registry
// coverage test and give an unknown finding until someone classifies it.
const groups = {
  harmless: `
    Add AddCorresponding Append Assert AuthorityCheck
    Break BreakId Case CaseType Catch CatchSystemExceptions Check
    Clear CloseCursor Collect Compute Concatenate Condense Continue Convert
    ConvertText Data DataBegin DataEnd DeleteInternal DeleteMemory
    Divide Do Else ElseIf EndAt EndCase EndCatch EndDo EndIf EndLoop
    EndOn EndProvide EndSelect EndTry EndWhile EndWith Exit FetchNextCursor
    FieldSymbol Find Free FreeMemory GetBit GetCursor GetLocale GetParameter
    GetReference GetRunTime GetTime If Import InsertInternal Local Loop
    ModifyInternal Move MoveCorresponding Multiply OnChange OpenCursor Overlay Pack Provide
    ReadLine ReadReport ReadTable ReadTextpool Refresh Replace Resume Retry
    Return Scan Search Select SelectLoop SetBit SetCountry SetExtendedCheck
    SetLanguage SetLocale SetParameter SetRunTime Shift Sort Split Static
    StaticBegin StaticEnd Subtract SubtractCorresponding Sum SyntaxCheck
    Translate Try Type TypeBegin TypeEnd TypeEnum TypeEnumBegin TypeEnumEnd
    TypeMesh TypeMeshBegin TypeMeshEnd Unassign Unpack When WhenOthers WhenType
    While With WithLoop
    Comment Empty
    Aliases ClassData ClassDataBegin ClassDataEnd ClassDeferred ClassDefinition
    ClassImplementation ClassLocalFriends Constant ConstantBegin ConstantEnd
    EndClass EndForm EndFunction EndInterface EndMethod EndModule
    EndOfDefinition Events Form FormDefinition FunctionModule FunctionPool
    IncludeType Interface InterfaceDef InterfaceDeferred MethodDef
    MethodImplementation Private Program Protected Public Ranges Report Tables
    TypePool TypePools
    Cleanup EndExec EndTestInjection EndTestSeam TestInjection TestSeam
    At AtFirst AtLast Extract InsertFieldGroup LoopExtract
    Format Hide ModifyLine NewLine NewPage Position PrintControl Reserve
    ScrollList SetBlank SetLeft SetMargin Skip Summary Uline Window Write
  `,
  // These have dedicated call/construction handling plus the recursive
  // expression walk (which also runs for assignments, reads and control flow).
  call: `Call CallFunction`,
  construction: `CreateObject Raise`,
  // Dynamic data/type designations can load classes without constructing an
  // instance. Their literal names and unknown targets need a separate audit.
  designation: `Assign AssignLocalCopy CreateData Describe`,
  write: `
    InsertDatabase UpdateDatabase ModifyDatabase DeleteDatabase MergeDatabase
    Commit Rollback CommitEntities RollbackEntities ModifyEntities
    ExecSQL NativeSQL CallDatabase SetUpdateTask CallTransaction Submit
    DeleteCluster InsertReport DeleteReport InsertTextpool DeleteTextpool
  `,
  // EXPORT is a write only TO DATABASE; its other forms copy data to memory,
  // a data buffer or a file, without executing application/database code.
  conditional: `Export`,
  // Nonlocal execution, implicit callbacks, kernel/native escapes and syntax
  // not yet modeled are deliberately uncertain. Even declaration-only kinds
  // are listed so an invalid/recovered occurrence in a body cannot be silent.
  unknown: `
    Unknown MacroCall MacroContent MacroRecursion
    AtLineSelection AtPF AtSelectionScreen AtUserCommand Back CallBadi
    CallDialog CallKernel CallOLE CallScreen CallSelectionScreen CallSubscreen
    CallTransformation Chain CheckSelectOptions ClassDefinitionLoad CloseDataset
    Communication Contexts Controls CreateOLE Define DeleteDataset DeleteDynpro
    Demand Detail DynproLoop EditorCall EndChain EndEnhancement
    EndEnhancementSection EndOfPage EndOfSelection Enhancement EnhancementPoint
    EnhancementSection ExportDynpro Field FieldGroup Fields FreeObject
    GenerateDynpro GenerateReport GenerateSubroutine Get GetBadi GetDataset
    GetPFStatus GetPermissions GetProperty ImportDynpro ImportNametab Include
    Infotypes Initialization Input InterfaceLoad Leave LoadOfProgram LoadReport
    LogPoint LoopAtScreen Message ModifyScreen Module Nodes OpenDataset Parameter
    Perform ProcessAfterInput ProcessBeforeOutput ProcessOnHelpRequest
    ProcessOnValueRequest Put RaiseEntityEvent RaiseEvent ReadDataset ReadEntities
    Receive RefreshControl Reject SelectOption SelectionScreen SetCursor
    SetDataset SetHandler SetLocks SetPFStatus SetProperty SetScreen SetTitlebar
    SetUserCommand SortDataset StartOfSelection Stop Supply SuppressDialog
    SystemCall TopOfPage Transfer TruncateDataset VerificationMessage Wait
  `,
};

export const STATEMENT_KINDS = Object.freeze(Object.fromEntries(
  Object.entries(groups).flatMap(([classification, kinds]) =>
    kinds.trim().split(/\s+/).map((kind) => [kind, classification]))));

export function statementKindOf(kind) {
  return Object.hasOwn(STATEMENT_KINDS, kind) ? STATEMENT_KINDS[kind] : "unknown";
}
