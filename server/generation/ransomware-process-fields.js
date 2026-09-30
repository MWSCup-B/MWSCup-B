const text = value => typeof value === 'string' && value.trim().length > 0;
const pid = value => Number.isSafeInteger(value) && value >= 0;

// Unknown ancestry is an explicit pair of nulls, not PID 0, a made-up ref,
// omitted columns, or permission to omit the incident's required direct parent.
// Use the same field contract for authored incident rows and ordinary samples.
export function ransomwareProcessProblems(row) {
  const problems = ['process_ref', 'user_ref', 'executable', 'command_line', 'start_result']
    .filter(key => !text(row[key]));
  if (!pid(row.pid)) problems.push('pid（非負整数）');
  const unknownParent = row.parent_pid === null && row.parent_ref === null;
  if (!unknownParent && (!pid(row.parent_pid) || !text(row.parent_ref)))
    problems.push('parent_pid / parent_ref（観測値の組、保存範囲外は両方を明示的にnull）');
  if (!unknownParent && (row.parent_pid === row.pid || row.parent_ref === row.process_ref))
    problems.push('parent_pid / parent_ref（自分自身を親にしない）');
  return problems;
}
