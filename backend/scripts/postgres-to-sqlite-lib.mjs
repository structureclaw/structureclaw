function omitKeys(row, keys) {
  const copy = { ...row };
  for (const key of keys) delete copy[key];
  return copy;
}

export function stripLegacyScalarLists(source) {
  const sanitized = { ...source };
  delete sanitized.users;
  delete sanitized.projects;
  delete sanitized.projectMembers;
  delete sanitized.userExpertise;
  delete sanitized.projectSkills;

  if (Array.isArray(sanitized.structuralModels)) {
    sanitized.structuralModels = sanitized.structuralModels.map((row) => omitKeys(row, ['projectId', 'createdBy']));
  }
  if (Array.isArray(sanitized.conversations)) {
    sanitized.conversations = sanitized.conversations.map((row) => omitKeys(row, ['userId']));
  }
  if (Array.isArray(sanitized.analyses)) {
    sanitized.analyses = sanitized.analyses.map((row) => omitKeys(row, ['createdBy']));
  }

  return sanitized;
}
