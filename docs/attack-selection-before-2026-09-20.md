# 攻撃選択拡張：修正前JSONの保管

2026-09-20。厳密なJSON形式を保つため、変更前の定義をHTMLコメントとして保管。修正後は各ファイルを参照。

<!-- 2026-09-20 修正前: schemas/candidate.schema.json（攻撃選択の拡張。JSONはコメント不可のためここに保存）
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Candidate assignment v1 (Backend internal)",
  "type": "object",
  "properties": {
    "schemaVersion": {
      "const": "1.0"
    },
    "selectedAttackIds": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 80,
        "pattern": "^[a-z][a-z0-9_-]*$"
      },
      "minItems": 1,
      "maxItems": 3
    },
    "assignments": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "attackId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "bindings": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "name": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "entityId": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                }
              },
              "required": [
                "name",
                "entityId"
              ],
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 16
          }
        },
        "required": [
          "attackId",
          "bindings"
        ],
        "additionalProperties": false
      },
      "minItems": 1,
      "maxItems": 3
    }
  },
  "required": [
    "schemaVersion",
    "selectedAttackIds",
    "assignments"
  ],
  "additionalProperties": false
}

-->

<!-- 2026-09-20 修正前: schemas/candidate-selection.schema.json（攻撃選択の拡張。JSONはコメント不可のためここに保存）
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Candidate selection v1 (Backend internal)",
  "type": "object",
  "properties": {
    "schemaVersion": {
      "const": "1.0"
    },
    "selectedAttackIds": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 80,
        "pattern": "^[a-z][a-z0-9_-]*$"
      },
      "minItems": 1,
      "maxItems": 3
    }
  },
  "required": [
    "schemaVersion",
    "selectedAttackIds"
  ],
  "additionalProperties": false
}

-->

<!-- 2026-09-20 修正前: schemas/candidate-builder-result.schema.json（攻撃選択の拡張。JSONはコメント不可のためここに保存）
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Candidate builder result v1 (Backend internal)",
  "type": "object",
  "properties": {
    "schemaVersion": {
      "const": "1.0"
    },
    "status": {
      "enum": [
        "CREATED",
        "BLOCKED"
      ]
    },
    "blocked": {
      "type": "boolean"
    },
    "complete": {
      "type": "boolean"
    },
    "scope": {
      "const": "TARGET_ASSIGNMENT_ONLY"
    },
    "inputDigest": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$"
    },
    "candidates": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "schemaVersion": {
            "const": "1.0"
          },
          "selectedAttackIds": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 80,
              "pattern": "^[a-z][a-z0-9_-]*$"
            },
            "minItems": 1,
            "maxItems": 3
          },
          "assignments": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "attackId": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "bindings": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "name": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 80,
                        "pattern": "^[a-z][a-z0-9_-]*$"
                      },
                      "entityId": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 80,
                        "pattern": "^[a-z][a-z0-9_-]*$"
                      }
                    },
                    "required": [
                      "name",
                      "entityId"
                    ],
                    "additionalProperties": false
                  },
                  "minItems": 1,
                  "maxItems": 16
                }
              },
              "required": [
                "attackId",
                "bindings"
              ],
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 3
          }
        },
        "required": [
          "schemaVersion",
          "selectedAttackIds",
          "assignments"
        ],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 100000
    },
    "diagnostics": {
      "type": "object",
      "properties": {
        "exploredStates": {
          "type": "number"
        },
        "searchLimit": {
          "type": "number"
        },
        "bindingCount": {
          "type": "number"
        },
        "candidateDomainSizes": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "attackId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80,
                "pattern": "^[a-z][a-z0-9_-]*$"
              },
              "binding": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80,
                "pattern": "^[a-z][a-z0-9_-]*$"
              },
              "size": {
                "type": "number"
              }
            },
            "required": [
              "attackId",
              "binding",
              "size"
            ],
            "additionalProperties": false
          },
          "minItems": 0,
          "maxItems": 48
        }
      },
      "required": [
        "exploredStates",
        "searchLimit",
        "bindingCount",
        "candidateDomainSizes"
      ],
      "additionalProperties": false
    },
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[A-Z][A-Z0-9_]*$"
          },
          "field": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          },
          "reason": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          },
          "suggestion": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          }
        },
        "required": [
          "code",
          "field",
          "reason",
          "suggestion"
        ],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 256
    }
  },
  "required": [
    "schemaVersion",
    "status",
    "blocked",
    "complete",
    "scope",
    "inputDigest",
    "candidates",
    "diagnostics",
    "issues"
  ],
  "additionalProperties": false
}

-->

<!-- 2026-09-20 修正前: schemas/attack-graph.schema.json（攻撃選択の拡張。JSONはコメント不可のためここに保存）
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Attack Graph v1",
  "type": "object",
  "properties": {
    "schemaVersion": {
      "const": "1.0"
    },
    "graphId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 160,
      "pattern": "^[a-z][a-z0-9_-]*$"
    },
    "state": {
      "const": "SATISFIED"
    },
    "structure": {
      "enum": [
        "SINGLE",
        "LINEAR",
        "BRANCHING",
        "JOIN",
        "PARALLEL",
        "MIXED"
      ]
    },
    "selectedAttackIds": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 80,
        "pattern": "^[a-z][a-z0-9_-]*$"
      },
      "minItems": 1,
      "maxItems": 3
    },
    "rootNodeIds": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 160,
        "pattern": "^[a-z][a-z0-9_-]*$"
      },
      "minItems": 1,
      "maxItems": 3
    },
    "leafNodeIds": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 160,
        "pattern": "^[a-z][a-z0-9_-]*$"
      },
      "minItems": 1,
      "maxItems": 3
    },
    "nodes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "nodeId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "attackDefinitionId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "attackDefinitionSchemaVersion": {
            "const": "1.0"
          },
          "state": {
            "const": "SATISFIED"
          },
          "bindings": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "name": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "entityId": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                }
              },
              "required": [
                "name",
                "entityId"
              ],
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 16
          },
          "evaluations": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "evaluationId": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "kind": {
                  "enum": [
                    "TARGET_TYPE",
                    "PLATFORM",
                    "REQUIRED_SERVICE",
                    "REACHABILITY",
                    "PREREQUISITE",
                    "REQUIRED_PRIVILEGE",
                    "ARTIFACT_CONDITION"
                  ]
                },
                "field": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256
                },
                "predicate": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "maxLength": 80
                },
                "args": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 80,
                    "pattern": "^[a-z][a-z0-9_-]*$"
                  },
                  "minItems": 0,
                  "maxItems": 8
                },
                "expectedValues": {
                  "type": "array",
                  "items": {
                    "type": [
                      "string",
                      "boolean"
                    ]
                  },
                  "minItems": 1,
                  "maxItems": 32
                },
                "actualValue": {
                  "type": [
                    "string",
                    "boolean",
                    "null"
                  ]
                },
                "state": {
                  "enum": [
                    "SATISFIED",
                    "UNSATISFIED",
                    "UNKNOWN"
                  ]
                },
                "origin": {
                  "enum": [
                    "NETWORK",
                    "SCENARIO_CONTEXT",
                    "ATTACK_EFFECT"
                  ]
                },
                "sourceRef": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "maxLength": 512
                },
                "producerNodeId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "maxLength": 160,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "definitionRef": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256
                },
                "reason": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2000
                }
              },
              "required": [
                "evaluationId",
                "kind",
                "field",
                "predicate",
                "args",
                "expectedValues",
                "actualValue",
                "state",
                "origin",
                "sourceRef",
                "producerNodeId",
                "definitionRef",
                "reason"
              ],
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 512
          },
          "effects": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "effectId": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "source": {
                  "enum": [
                    "attackerInitialPrivileges",
                    "authenticationConditions",
                    "otherConditions"
                  ]
                },
                "predicate": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "args": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 80,
                    "pattern": "^[a-z][a-z0-9_-]*$"
                  },
                  "minItems": 1,
                  "maxItems": 8
                },
                "value": {
                  "type": "boolean"
                },
                "description": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2000
                },
                "definitionRef": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256
                }
              },
              "required": [
                "effectId",
                "source",
                "predicate",
                "args",
                "value",
                "description",
                "definitionRef"
              ],
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 64
          },
          "artifactEvaluations": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "artifactId": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "description": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2000
                },
                "state": {
                  "enum": [
                    "SATISFIED",
                    "UNSATISFIED",
                    "UNKNOWN"
                  ]
                },
                "evaluations": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "evaluationId": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 160,
                        "pattern": "^[a-z][a-z0-9_-]*$"
                      },
                      "kind": {
                        "enum": [
                          "TARGET_TYPE",
                          "PLATFORM",
                          "REQUIRED_SERVICE",
                          "REACHABILITY",
                          "PREREQUISITE",
                          "REQUIRED_PRIVILEGE",
                          "ARTIFACT_CONDITION"
                        ]
                      },
                      "field": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 256
                      },
                      "predicate": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "maxLength": 80
                      },
                      "args": {
                        "type": "array",
                        "items": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 80,
                          "pattern": "^[a-z][a-z0-9_-]*$"
                        },
                        "minItems": 0,
                        "maxItems": 8
                      },
                      "expectedValues": {
                        "type": "array",
                        "items": {
                          "type": [
                            "string",
                            "boolean"
                          ]
                        },
                        "minItems": 1,
                        "maxItems": 32
                      },
                      "actualValue": {
                        "type": [
                          "string",
                          "boolean",
                          "null"
                        ]
                      },
                      "state": {
                        "enum": [
                          "SATISFIED",
                          "UNSATISFIED",
                          "UNKNOWN"
                        ]
                      },
                      "origin": {
                        "enum": [
                          "NETWORK",
                          "SCENARIO_CONTEXT",
                          "ATTACK_EFFECT"
                        ]
                      },
                      "sourceRef": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "maxLength": 512
                      },
                      "producerNodeId": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "maxLength": 160,
                        "pattern": "^[a-z][a-z0-9_-]*$"
                      },
                      "definitionRef": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 256
                      },
                      "reason": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 2000
                      }
                    },
                    "required": [
                      "evaluationId",
                      "kind",
                      "field",
                      "predicate",
                      "args",
                      "expectedValues",
                      "actualValue",
                      "state",
                      "origin",
                      "sourceRef",
                      "producerNodeId",
                      "definitionRef",
                      "reason"
                    ],
                    "additionalProperties": false
                  },
                  "minItems": 1,
                  "maxItems": 32
                }
              },
              "required": [
                "artifactId",
                "description",
                "state",
                "evaluations"
              ],
              "additionalProperties": false
            },
            "minItems": 0,
            "maxItems": 64
          },
          "referenceIds": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 80,
              "pattern": "^[a-z][a-z0-9_-]*$"
            },
            "minItems": 1,
            "maxItems": 32
          }
        },
        "required": [
          "nodeId",
          "attackDefinitionId",
          "attackDefinitionSchemaVersion",
          "state",
          "bindings",
          "evaluations",
          "effects",
          "artifactEvaluations",
          "referenceIds"
        ],
        "additionalProperties": false
      },
      "minItems": 1,
      "maxItems": 3
    },
    "edges": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "edgeId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "type": {
            "const": "ENABLES"
          },
          "from": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "to": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "effectId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "prerequisiteEvaluationId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "matchedFact": {
            "type": "object",
            "properties": {
              "source": {
                "enum": [
                  "attackerInitialPrivileges",
                  "authenticationConditions",
                  "otherConditions"
                ]
              },
              "predicate": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80,
                "pattern": "^[a-z][a-z0-9_-]*$"
              },
              "args": {
                "type": "array",
                "items": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "minItems": 1,
                "maxItems": 8
              },
              "value": {
                "type": "boolean"
              }
            },
            "required": [
              "source",
              "predicate",
              "args",
              "value"
            ],
            "additionalProperties": false
          },
          "grounds": {
            "type": "object",
            "properties": {
              "matchType": {
                "const": "EXACT_FACT_AND_VALUE"
              },
              "producerState": {
                "const": "SATISFIED"
              },
              "consumerState": {
                "const": "SATISFIED"
              },
              "reason": {
                "type": "string",
                "minLength": 1,
                "maxLength": 2000
              }
            },
            "required": [
              "matchType",
              "producerState",
              "consumerState",
              "reason"
            ],
            "additionalProperties": false
          }
        },
        "required": [
          "edgeId",
          "type",
          "from",
          "to",
          "effectId",
          "prerequisiteEvaluationId",
          "matchedFact",
          "grounds"
        ],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 192
    },
    "executionConstraints": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "before": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "after": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "reasonCode": {
            "const": "STATE_WRITE_CONFLICT"
          },
          "fact": {
            "type": "object",
            "properties": {
              "source": {
                "enum": [
                  "attackerInitialPrivileges",
                  "authenticationConditions",
                  "otherConditions"
                ]
              },
              "predicate": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80,
                "pattern": "^[a-z][a-z0-9_-]*$"
              },
              "args": {
                "type": "array",
                "items": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "minItems": 1,
                "maxItems": 8
              },
              "value": {
                "type": "boolean"
              }
            },
            "required": [
              "source",
              "predicate",
              "args",
              "value"
            ],
            "additionalProperties": false
          }
        },
        "required": [
          "before",
          "after",
          "reasonCode",
          "fact"
        ],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 192
    },
    "components": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "componentId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "structure": {
            "enum": [
              "SINGLE",
              "LINEAR",
              "BRANCHING",
              "JOIN",
              "MIXED"
            ]
          },
          "nodeIds": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 160,
              "pattern": "^[a-z][a-z0-9_-]*$"
            },
            "minItems": 1,
            "maxItems": 3
          }
        },
        "required": [
          "componentId",
          "structure",
          "nodeIds"
        ],
        "additionalProperties": false
      },
      "minItems": 1,
      "maxItems": 3
    },
    "sourcePlanOrders": {
      "type": "array",
      "items": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80,
          "pattern": "^[a-z][a-z0-9_-]*$"
        },
        "minItems": 1,
        "maxItems": 3
      },
      "minItems": 1,
      "maxItems": 6
    }
  },
  "required": [
    "schemaVersion",
    "graphId",
    "state",
    "structure",
    "selectedAttackIds",
    "rootNodeIds",
    "leafNodeIds",
    "nodes",
    "edges",
    "executionConstraints",
    "components",
    "sourcePlanOrders"
  ],
  "additionalProperties": false
}

-->

<!-- 2026-09-20 修正前: schemas/attack-graph-result.schema.json（攻撃選択の拡張。JSONはコメント不可のためここに保存）
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Attack Graph Build Result v1",
  "type": "object",
  "properties": {
    "schemaVersion": {
      "const": "1.0"
    },
    "status": {
      "enum": [
        "CREATED",
        "BLOCKED"
      ]
    },
    "evaluationState": {
      "enum": [
        "SATISFIED",
        "UNSATISFIED",
        "UNKNOWN",
        null
      ]
    },
    "scope": {
      "const": "CANDIDATE_FEASIBILITY_ONLY"
    },
    "inputDigest": {
      "type": "string",
      "minLength": 64,
      "maxLength": 64,
      "pattern": "^[a-f0-9]{64}$"
    },
    "graphs": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "schemaVersion": {
            "const": "1.0"
          },
          "graphId": {
            "type": "string",
            "minLength": 1,
            "maxLength": 160,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "state": {
            "const": "SATISFIED"
          },
          "structure": {
            "enum": [
              "SINGLE",
              "LINEAR",
              "BRANCHING",
              "JOIN",
              "PARALLEL",
              "MIXED"
            ]
          },
          "selectedAttackIds": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 80,
              "pattern": "^[a-z][a-z0-9_-]*$"
            },
            "minItems": 1,
            "maxItems": 3
          },
          "rootNodeIds": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 160,
              "pattern": "^[a-z][a-z0-9_-]*$"
            },
            "minItems": 1,
            "maxItems": 3
          },
          "leafNodeIds": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 160,
              "pattern": "^[a-z][a-z0-9_-]*$"
            },
            "minItems": 1,
            "maxItems": 3
          },
          "nodes": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "nodeId": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "attackDefinitionId": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "attackDefinitionSchemaVersion": {
                  "const": "1.0"
                },
                "state": {
                  "const": "SATISFIED"
                },
                "bindings": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "name": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 80,
                        "pattern": "^[a-z][a-z0-9_-]*$"
                      },
                      "entityId": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 80,
                        "pattern": "^[a-z][a-z0-9_-]*$"
                      }
                    },
                    "required": [
                      "name",
                      "entityId"
                    ],
                    "additionalProperties": false
                  },
                  "minItems": 1,
                  "maxItems": 16
                },
                "evaluations": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "evaluationId": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 160,
                        "pattern": "^[a-z][a-z0-9_-]*$"
                      },
                      "kind": {
                        "enum": [
                          "TARGET_TYPE",
                          "PLATFORM",
                          "REQUIRED_SERVICE",
                          "REACHABILITY",
                          "PREREQUISITE",
                          "REQUIRED_PRIVILEGE",
                          "ARTIFACT_CONDITION"
                        ]
                      },
                      "field": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 256
                      },
                      "predicate": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "maxLength": 80
                      },
                      "args": {
                        "type": "array",
                        "items": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 80,
                          "pattern": "^[a-z][a-z0-9_-]*$"
                        },
                        "minItems": 0,
                        "maxItems": 8
                      },
                      "expectedValues": {
                        "type": "array",
                        "items": {
                          "type": [
                            "string",
                            "boolean"
                          ]
                        },
                        "minItems": 1,
                        "maxItems": 32
                      },
                      "actualValue": {
                        "type": [
                          "string",
                          "boolean",
                          "null"
                        ]
                      },
                      "state": {
                        "enum": [
                          "SATISFIED",
                          "UNSATISFIED",
                          "UNKNOWN"
                        ]
                      },
                      "origin": {
                        "enum": [
                          "NETWORK",
                          "SCENARIO_CONTEXT",
                          "ATTACK_EFFECT"
                        ]
                      },
                      "sourceRef": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "maxLength": 512
                      },
                      "producerNodeId": {
                        "type": [
                          "string",
                          "null"
                        ],
                        "maxLength": 160,
                        "pattern": "^[a-z][a-z0-9_-]*$"
                      },
                      "definitionRef": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 256
                      },
                      "reason": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 2000
                      }
                    },
                    "required": [
                      "evaluationId",
                      "kind",
                      "field",
                      "predicate",
                      "args",
                      "expectedValues",
                      "actualValue",
                      "state",
                      "origin",
                      "sourceRef",
                      "producerNodeId",
                      "definitionRef",
                      "reason"
                    ],
                    "additionalProperties": false
                  },
                  "minItems": 1,
                  "maxItems": 512
                },
                "effects": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "effectId": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 160,
                        "pattern": "^[a-z][a-z0-9_-]*$"
                      },
                      "source": {
                        "enum": [
                          "attackerInitialPrivileges",
                          "authenticationConditions",
                          "otherConditions"
                        ]
                      },
                      "predicate": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 80,
                        "pattern": "^[a-z][a-z0-9_-]*$"
                      },
                      "args": {
                        "type": "array",
                        "items": {
                          "type": "string",
                          "minLength": 1,
                          "maxLength": 80,
                          "pattern": "^[a-z][a-z0-9_-]*$"
                        },
                        "minItems": 1,
                        "maxItems": 8
                      },
                      "value": {
                        "type": "boolean"
                      },
                      "description": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 2000
                      },
                      "definitionRef": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 256
                      }
                    },
                    "required": [
                      "effectId",
                      "source",
                      "predicate",
                      "args",
                      "value",
                      "description",
                      "definitionRef"
                    ],
                    "additionalProperties": false
                  },
                  "minItems": 1,
                  "maxItems": 64
                },
                "artifactEvaluations": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "artifactId": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 80,
                        "pattern": "^[a-z][a-z0-9_-]*$"
                      },
                      "description": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 2000
                      },
                      "state": {
                        "enum": [
                          "SATISFIED",
                          "UNSATISFIED",
                          "UNKNOWN"
                        ]
                      },
                      "evaluations": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "evaluationId": {
                              "type": "string",
                              "minLength": 1,
                              "maxLength": 160,
                              "pattern": "^[a-z][a-z0-9_-]*$"
                            },
                            "kind": {
                              "enum": [
                                "TARGET_TYPE",
                                "PLATFORM",
                                "REQUIRED_SERVICE",
                                "REACHABILITY",
                                "PREREQUISITE",
                                "REQUIRED_PRIVILEGE",
                                "ARTIFACT_CONDITION"
                              ]
                            },
                            "field": {
                              "type": "string",
                              "minLength": 1,
                              "maxLength": 256
                            },
                            "predicate": {
                              "type": [
                                "string",
                                "null"
                              ],
                              "maxLength": 80
                            },
                            "args": {
                              "type": "array",
                              "items": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 80,
                                "pattern": "^[a-z][a-z0-9_-]*$"
                              },
                              "minItems": 0,
                              "maxItems": 8
                            },
                            "expectedValues": {
                              "type": "array",
                              "items": {
                                "type": [
                                  "string",
                                  "boolean"
                                ]
                              },
                              "minItems": 1,
                              "maxItems": 32
                            },
                            "actualValue": {
                              "type": [
                                "string",
                                "boolean",
                                "null"
                              ]
                            },
                            "state": {
                              "enum": [
                                "SATISFIED",
                                "UNSATISFIED",
                                "UNKNOWN"
                              ]
                            },
                            "origin": {
                              "enum": [
                                "NETWORK",
                                "SCENARIO_CONTEXT",
                                "ATTACK_EFFECT"
                              ]
                            },
                            "sourceRef": {
                              "type": [
                                "string",
                                "null"
                              ],
                              "maxLength": 512
                            },
                            "producerNodeId": {
                              "type": [
                                "string",
                                "null"
                              ],
                              "maxLength": 160,
                              "pattern": "^[a-z][a-z0-9_-]*$"
                            },
                            "definitionRef": {
                              "type": "string",
                              "minLength": 1,
                              "maxLength": 256
                            },
                            "reason": {
                              "type": "string",
                              "minLength": 1,
                              "maxLength": 2000
                            }
                          },
                          "required": [
                            "evaluationId",
                            "kind",
                            "field",
                            "predicate",
                            "args",
                            "expectedValues",
                            "actualValue",
                            "state",
                            "origin",
                            "sourceRef",
                            "producerNodeId",
                            "definitionRef",
                            "reason"
                          ],
                          "additionalProperties": false
                        },
                        "minItems": 1,
                        "maxItems": 32
                      }
                    },
                    "required": [
                      "artifactId",
                      "description",
                      "state",
                      "evaluations"
                    ],
                    "additionalProperties": false
                  },
                  "minItems": 0,
                  "maxItems": 64
                },
                "referenceIds": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 80,
                    "pattern": "^[a-z][a-z0-9_-]*$"
                  },
                  "minItems": 1,
                  "maxItems": 32
                }
              },
              "required": [
                "nodeId",
                "attackDefinitionId",
                "attackDefinitionSchemaVersion",
                "state",
                "bindings",
                "evaluations",
                "effects",
                "artifactEvaluations",
                "referenceIds"
              ],
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 3
          },
          "edges": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "edgeId": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "type": {
                  "const": "ENABLES"
                },
                "from": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "to": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "effectId": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "prerequisiteEvaluationId": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "matchedFact": {
                  "type": "object",
                  "properties": {
                    "source": {
                      "enum": [
                        "attackerInitialPrivileges",
                        "authenticationConditions",
                        "otherConditions"
                      ]
                    },
                    "predicate": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 80,
                      "pattern": "^[a-z][a-z0-9_-]*$"
                    },
                    "args": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 80,
                        "pattern": "^[a-z][a-z0-9_-]*$"
                      },
                      "minItems": 1,
                      "maxItems": 8
                    },
                    "value": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "source",
                    "predicate",
                    "args",
                    "value"
                  ],
                  "additionalProperties": false
                },
                "grounds": {
                  "type": "object",
                  "properties": {
                    "matchType": {
                      "const": "EXACT_FACT_AND_VALUE"
                    },
                    "producerState": {
                      "const": "SATISFIED"
                    },
                    "consumerState": {
                      "const": "SATISFIED"
                    },
                    "reason": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 2000
                    }
                  },
                  "required": [
                    "matchType",
                    "producerState",
                    "consumerState",
                    "reason"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "edgeId",
                "type",
                "from",
                "to",
                "effectId",
                "prerequisiteEvaluationId",
                "matchedFact",
                "grounds"
              ],
              "additionalProperties": false
            },
            "minItems": 0,
            "maxItems": 192
          },
          "executionConstraints": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "before": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "after": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "reasonCode": {
                  "const": "STATE_WRITE_CONFLICT"
                },
                "fact": {
                  "type": "object",
                  "properties": {
                    "source": {
                      "enum": [
                        "attackerInitialPrivileges",
                        "authenticationConditions",
                        "otherConditions"
                      ]
                    },
                    "predicate": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 80,
                      "pattern": "^[a-z][a-z0-9_-]*$"
                    },
                    "args": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 80,
                        "pattern": "^[a-z][a-z0-9_-]*$"
                      },
                      "minItems": 1,
                      "maxItems": 8
                    },
                    "value": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "source",
                    "predicate",
                    "args",
                    "value"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "before",
                "after",
                "reasonCode",
                "fact"
              ],
              "additionalProperties": false
            },
            "minItems": 0,
            "maxItems": 192
          },
          "components": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "componentId": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 160,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "structure": {
                  "enum": [
                    "SINGLE",
                    "LINEAR",
                    "BRANCHING",
                    "JOIN",
                    "MIXED"
                  ]
                },
                "nodeIds": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 160,
                    "pattern": "^[a-z][a-z0-9_-]*$"
                  },
                  "minItems": 1,
                  "maxItems": 3
                }
              },
              "required": [
                "componentId",
                "structure",
                "nodeIds"
              ],
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 3
          },
          "sourcePlanOrders": {
            "type": "array",
            "items": {
              "type": "array",
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80,
                "pattern": "^[a-z][a-z0-9_-]*$"
              },
              "minItems": 1,
              "maxItems": 3
            },
            "minItems": 1,
            "maxItems": 6
          }
        },
        "required": [
          "schemaVersion",
          "graphId",
          "state",
          "structure",
          "selectedAttackIds",
          "rootNodeIds",
          "leafNodeIds",
          "nodes",
          "edges",
          "executionConstraints",
          "components",
          "sourcePlanOrders"
        ],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 6
    },
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[A-Z][A-Z0-9_]*$"
          },
          "category": {
            "enum": [
              "INVALID_INPUT",
              "MISSING_INFORMATION",
              "TECHNICAL_INFEASIBILITY"
            ]
          },
          "state": {
            "enum": [
              "UNSATISFIED",
              "UNKNOWN",
              null
            ]
          },
          "attackId": {
            "type": [
              "string",
              "null"
            ],
            "maxLength": 80,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "field": {
            "type": "string",
            "minLength": 1,
            "maxLength": 256
          },
          "subjects": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 80,
              "pattern": "^[a-z][a-z0-9_-]*$"
            },
            "minItems": 0,
            "maxItems": 8
          },
          "reason": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          },
          "suggestion": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          },
          "sourceRefs": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 512
            },
            "minItems": 0,
            "maxItems": 16
          }
        },
        "required": [
          "code",
          "category",
          "state",
          "attackId",
          "field",
          "subjects",
          "reason",
          "suggestion",
          "sourceRefs"
        ],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 192
    }
  },
  "required": [
    "schemaVersion",
    "status",
    "evaluationState",
    "scope",
    "inputDigest",
    "graphs",
    "issues"
  ],
  "additionalProperties": false
}

-->

<!-- 2026-09-20 修正前: schemas/learning-objective.schema.json（攻撃選択の拡張。JSONはコメント不可のためここに保存）
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Learning Objective Set v1 (Backend internal)",
  "type": "object",
  "properties": {
    "schemaVersion": { "const": "1.0" },
    "learningObjectiveSetId": { "type": "string", "minLength": 1, "maxLength": 160, "pattern": "^[a-z][a-z0-9_-]*$" },
    "scenarioId": { "type": "string", "minLength": 1, "maxLength": 160, "pattern": "^[a-z][a-z0-9_-]*$" },
    "attackGraphRef": {
      "type": "object",
      "properties": {
        "inputDigest": { "type": "string", "minLength": 64, "maxLength": 64, "pattern": "^[a-f0-9]{64}$" },
        "graphId": { "type": "string", "minLength": 1, "maxLength": 160, "pattern": "^[a-z][a-z0-9_-]*$" }
      },
      "required": ["inputDigest", "graphId"],
      "additionalProperties": false
    },
    "objectives": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "objectiveId": { "type": "string", "minLength": 1, "maxLength": 160, "pattern": "^[a-z][a-z0-9_-]*$" },
          "description": { "type": "string", "minLength": 1, "maxLength": 2000 },
          "origin": { "enum": ["USER_PROVIDED", "DERIVED_FROM_TECHNICAL_INPUT"] },
          "selectedAttackIds": {
            "type": "array",
            "items": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" },
            "minItems": 0,
            "maxItems": 3
          },
          "attackNodeIds": {
            "type": "array",
            "items": { "type": "string", "minLength": 1, "maxLength": 160, "pattern": "^[a-z][a-z0-9_-]*$" },
            "minItems": 0,
            "maxItems": 3
          },
          "definitionReferenceRefs": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "attackDefinitionId": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" },
                "referenceId": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" }
              },
              "required": ["attackDefinitionId", "referenceId"],
              "additionalProperties": false
            },
            "minItems": 0,
            "maxItems": 96
          }
        },
        "required": ["objectiveId", "description", "origin", "selectedAttackIds", "attackNodeIds", "definitionReferenceRefs"],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 128
    }
  },
  "required": ["schemaVersion", "learningObjectiveSetId", "scenarioId", "attackGraphRef", "objectives"],
  "additionalProperties": false
}

-->

<!-- 2026-09-20 修正前: schemas/scenario-generation-input.schema.json（攻撃選択の拡張。JSONはコメント不可のためここに保存）
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "External Scenario Generation Input v1 (Backend internal)",
  "type": "object",
  "properties": {
    "schemaVersion": { "const": "1.0" },
    "generationInputId": { "type": "string", "minLength": 1, "maxLength": 200, "pattern": "^[a-z][a-z0-9_-]*$" },
    "generatorMode": { "const": "EXTERNAL_USER_CODEX" },
    "promptTemplateVersion": { "const": "1.0" },
    "attackGraphRef": {
      "type": "object",
      "properties": {
        "inputDigest": { "type": "string", "minLength": 64, "maxLength": 64, "pattern": "^[a-f0-9]{64}$" },
        "graphId": { "type": "string", "minLength": 1, "maxLength": 160, "pattern": "^[a-z][a-z0-9_-]*$" }
      },
      "required": ["inputDigest", "graphId"],
      "additionalProperties": false
    },
    "selectedAttackIds": {
      "type": "array",
      "items": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" },
      "minItems": 1,
      "maxItems": 3
    },
    "technicalInput": {
      "type": "object",
      "properties": {
        "network": { "type": "object", "additionalProperties": true },
        "scenarioContext": { "type": "object", "additionalProperties": true },
        "candidate": { "type": "object", "additionalProperties": true },
        "attackDefinitions": {
          "type": "array",
          "items": { "type": "object", "additionalProperties": true },
          "minItems": 1,
          "maxItems": 256
        },
        "attackGraph": { "type": "object", "additionalProperties": true }
      },
      "required": ["network", "scenarioContext", "candidate", "attackDefinitions", "attackGraph"],
      "additionalProperties": false
    },
    "outputContract": {
      "type": "object",
      "properties": {
        "schemaVersion": { "const": "1.0" },
        "requiredArtifacts": {
          "type": "array",
          "items": { "enum": ["scenarioDraft", "groundTruth", "characters", "timeline", "learningObjectives", "evidenceRequirements"] },
          "minItems": 6,
          "maxItems": 6
        },
        "packageSchema": { "type": "object", "additionalProperties": true },
        "artifactSchemas": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "artifact": { "enum": ["scenarioDraft", "groundTruth", "characters", "timeline", "learningObjectives", "evidenceRequirements"] },
              "schemaVersion": { "const": "1.0" },
              "jsonSchema": { "type": "object", "additionalProperties": true }
            },
            "required": ["artifact", "schemaVersion", "jsonSchema"],
            "additionalProperties": false
          },
          "minItems": 6,
          "maxItems": 6
        }
      },
      "required": ["schemaVersion", "requiredArtifacts", "packageSchema", "artifactSchemas"],
      "additionalProperties": false
    }
  },
  "required": ["schemaVersion", "generationInputId", "generatorMode", "promptTemplateVersion", "attackGraphRef", "selectedAttackIds", "technicalInput", "outputContract"],
  "additionalProperties": false
}

-->

<!-- 2026-09-20 修正前: schemas/timeline.schema.json（攻撃選択の拡張。JSONはコメント不可のためここに保存）
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Technical Timeline v1 (Backend internal)",
  "type": "object",
  "properties": {
    "schemaVersion": { "const": "1.0" },
    "timelineId": { "type": "string", "minLength": 1, "maxLength": 160, "pattern": "^[a-z][a-z0-9_-]*$" },
    "scenarioId": { "type": "string", "minLength": 1, "maxLength": 160, "pattern": "^[a-z][a-z0-9_-]*$" },
    "attackGraphRef": {
      "type": "object",
      "properties": {
        "inputDigest": { "type": "string", "minLength": 64, "maxLength": 64, "pattern": "^[a-f0-9]{64}$" },
        "graphId": { "type": "string", "minLength": 1, "maxLength": 160, "pattern": "^[a-z][a-z0-9_-]*$" }
      },
      "required": ["inputDigest", "graphId"],
      "additionalProperties": false
    },
    "events": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "eventId": { "type": "string", "minLength": 1, "maxLength": 160, "pattern": "^[a-z][a-z0-9_-]*$" },
          "order": { "type": "number" },
          "dependsOn": {
            "type": "array",
            "items": { "type": "string", "minLength": 1, "maxLength": 160, "pattern": "^[a-z][a-z0-9_-]*$" },
            "minItems": 0,
            "maxItems": 3
          },
          "attackNodeId": { "type": "string", "minLength": 1, "maxLength": 160, "pattern": "^[a-z][a-z0-9_-]*$" }
        },
        "required": ["eventId", "order", "dependsOn", "attackNodeId"],
        "additionalProperties": false
      },
      "minItems": 1,
      "maxItems": 3
    },
    "narrativeTimestamps": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "eventId": { "type": "string", "minLength": 1, "maxLength": 160, "pattern": "^[a-z][a-z0-9_-]*$" },
          "displayTimestamp": { "type": "string", "minLength": 1, "maxLength": 200 }
        },
        "required": ["eventId", "displayTimestamp"],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 3
    }
  },
  "required": ["schemaVersion", "timelineId", "scenarioId", "attackGraphRef", "events", "narrativeTimestamps"],
  "additionalProperties": false
}

-->

<!-- 2026-09-20 修正前: schemas/scenario-configuration.schema.json（攻撃選択の拡張。JSONはコメント不可のためここに保存）
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Scenario Configuration v1",
  "type": "object",
  "properties": {
    "schemaVersion": { "const": "1.0" },
    "configurationId": { "type": "string", "minLength": 1, "maxLength": 120, "pattern": "^[a-z][a-z0-9_-]*$" },
    "mode": { "enum": ["MANUAL", "MAKOTOMARU"] },
    "difficulty": { "enum": [1, 2, 3] },
    "evidenceCount": { "enum": [1, 2, 3] },
    "network": {
      "type": "object",
      "properties": {
        "subnets": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "subnetId": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" },
              "label": { "type": "string", "minLength": 1, "maxLength": 120 },
              "cidr": { "type": "string", "minLength": 3, "maxLength": 80 },
              "trustBoundaryId": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" }
            },
            "required": ["subnetId", "label", "cidr", "trustBoundaryId"],
            "additionalProperties": false
          },
          "minItems": 1,
          "maxItems": 32
        },
        "nodes": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "nodeId": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" },
              "label": { "type": "string", "minLength": 1, "maxLength": 120 },
              "nodeType": { "enum": ["CLIENT", "SERVER", "PROXY", "WEB_SERVER", "DATABASE", "AD", "FILE_SERVER", "LOG_SERVER", "MAIL_SERVER", "EXTERNAL"] },
              "os": { "enum": ["windows", "linux", "macos", "network", "other"] },
              "ip": { "type": "string", "minLength": 3, "maxLength": 80 },
              "subnetId": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" },
              "trustBoundaryId": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" },
              "roles": { "type": "array", "items": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" }, "minItems": 1, "maxItems": 16 },
              "logSources": { "type": "array", "items": { "enum": ["WEB_LOG", "PROXY_LOG", "AUTH_LOG", "APPLICATION_LOG", "NETWORK_LOG", "EMAIL", "BROWSER_HISTORY", "DEVICE", "FILE", "CONFIGURATION"] }, "minItems": 0, "maxItems": 10 }
            },
            "required": ["nodeId", "label", "nodeType", "os", "ip", "subnetId", "trustBoundaryId", "roles", "logSources"],
            "additionalProperties": false
          },
          "minItems": 1,
          "maxItems": 128
        },
        "services": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "serviceId": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" },
              "nodeId": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" },
              "label": { "type": "string", "minLength": 1, "maxLength": 120 },
              "serviceType": { "enum": ["web_browser", "email", "web_application", "sql_database", "proxy", "authentication", "file", "logging"] },
              "platform": { "enum": ["browser", "email", "web", "sql", "proxy", "auth", "file", "logging"] }
            },
            "required": ["serviceId", "nodeId", "label", "serviceType", "platform"],
            "additionalProperties": false
          },
          "minItems": 1,
          "maxItems": 256
        },
        "connections": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "fromNodeId": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" },
              "toNodeId": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" }
            },
            "required": ["fromNodeId", "toNodeId"],
            "additionalProperties": false
          },
          "minItems": 0,
          "maxItems": 1024
        }
      },
      "required": ["subnets", "nodes", "services", "connections"],
      "additionalProperties": false
    },
    "attacks": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "attackId": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" },
          "order": { "enum": [1, 2, 3] },
          "occurrenceTime": { "type": "string", "minLength": 20, "maxLength": 40, "format": "date-time" },
          "sourceNodeId": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" },
          "targetNodeId": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" },
          "targetServiceId": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" },
          "investigationTypes": { "type": "array", "items": { "enum": ["WEB_LOG", "PROXY_LOG", "AUTH_LOG", "APPLICATION_LOG", "NETWORK_LOG", "EMAIL", "BROWSER_HISTORY", "DEVICE", "FILE", "CONFIGURATION"] }, "minItems": 1, "maxItems": 4 },
          "investigationSourceNodeId": { "type": "string", "minLength": 1, "maxLength": 80, "pattern": "^[a-z][a-z0-9_-]*$" },
          "evidenceAnswer": { "type": "string", "minLength": 1, "maxLength": 1000 },
          "expectedEffect": { "type": "string", "minLength": 1, "maxLength": 500 },
          "notes": { "type": "string", "maxLength": 1000 }
        },
        "required": ["attackId", "order", "occurrenceTime", "sourceNodeId", "targetNodeId", "targetServiceId", "investigationTypes", "investigationSourceNodeId", "evidenceAnswer", "expectedEffect", "notes"],
        "additionalProperties": false
      },
      "minItems": 1,
      "maxItems": 3
    },
    "incidentContext": {
      "type": "object",
      "properties": {
        "incidentDate": { "type": "string", "minLength": 10, "maxLength": 10, "format": "date" },
        "organizationName": { "type": "string", "minLength": 1, "maxLength": 120 },
        "victimSystem": { "type": "string", "minLength": 1, "maxLength": 120 },
        "accusedRole": { "type": "string", "minLength": 1, "maxLength": 120 },
        "initialSuspicionReason": { "type": "string", "minLength": 1, "maxLength": 500 }
      },
      "required": ["incidentDate", "organizationName", "victimSystem", "accusedRole", "initialSuspicionReason"],
      "additionalProperties": false
    }
  },
  "required": ["schemaVersion", "configurationId", "mode", "difficulty", "evidenceCount", "network", "attacks", "incidentContext"],
  "additionalProperties": false
}

-->

<!-- 2026-09-20 修正前: schemas/attack-definition.schema.json（攻撃選択の拡張。JSONはコメント不可のためここに保存）
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Attack Definition v1",
  "type": "object",
  "properties": {
    "schemaVersion": {
      "const": "1.0"
    },
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 80,
      "pattern": "^[a-z][a-z0-9_-]*$"
    },
    "label": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2000
    },
    "description": {
      "type": "string",
      "minLength": 1,
      "maxLength": 2000
    },
    "supportedInvestigationTypes": {
      "type": "array",
      "items": {
        "enum": ["WEB_LOG", "PROXY_LOG", "AUTH_LOG", "APPLICATION_LOG", "NETWORK_LOG", "EMAIL", "BROWSER_HISTORY", "DEVICE", "FILE", "CONFIGURATION"]
      },
      "minItems": 1,
      "maxItems": 10
    },
    "category": {
      "type": "string",
      "minLength": 1,
      "maxLength": 80,
      "pattern": "^[a-z][a-z0-9_-]*$"
    },
    "authoring": {
      "type": "object",
      "properties": {
        "preferredInvestigationType": {
          "enum": ["WEB_LOG", "PROXY_LOG", "AUTH_LOG", "APPLICATION_LOG", "NETWORK_LOG", "EMAIL", "BROWSER_HISTORY", "DEVICE", "FILE", "CONFIGURATION"]
        },
        "evidenceAnswer": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000
        },
        "sourceNodeBinding": {
          "type": "string", "minLength": 1, "maxLength": 80,
          "pattern": "^[a-z][a-z0-9_-]*$"
        },
        "targetServiceBinding": {
          "type": "string", "minLength": 1, "maxLength": 80,
          "pattern": "^[a-z][a-z0-9_-]*$"
        },
        "investigationServiceBinding": {
          "type": "string", "minLength": 1, "maxLength": 80,
          "pattern": "^[a-z][a-z0-9_-]*$"
        }
      },
      "required": ["preferredInvestigationType", "evidenceAnswer", "sourceNodeBinding", "targetServiceBinding", "investigationServiceBinding"],
      "additionalProperties": false
    },
    "bindings": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "kind": {
            "enum": [
              "node",
              "service",
              "entity"
            ]
          }
        },
        "required": [
          "id",
          "kind"
        ],
        "additionalProperties": false
      },
      "minItems": 1,
      "maxItems": 16
    },
    "targetTypes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "binding": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "values": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 80,
              "pattern": "^[a-z][a-z0-9_-]*$"
            },
            "minItems": 1,
            "maxItems": 32
          }
        },
        "required": [
          "binding",
          "values"
        ],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 256
    },
    "requiredRoles": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "binding": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "values": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 80,
              "pattern": "^[a-z][a-z0-9_-]*$"
            },
            "minItems": 1,
            "maxItems": 32
          }
        },
        "required": [
          "binding",
          "values"
        ],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 256
    },
    "platforms": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "binding": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "values": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 80,
              "pattern": "^[a-z][a-z0-9_-]*$"
            },
            "minItems": 1,
            "maxItems": 32
          }
        },
        "required": [
          "binding",
          "values"
        ],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 256
    },
    "requiredServices": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "binding": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "values": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 80,
              "pattern": "^[a-z][a-z0-9_-]*$"
            },
            "minItems": 1,
            "maxItems": 32
          },
          "node": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z][a-z0-9_-]*$"
          }
        },
        "required": [
          "binding",
          "values",
          "node"
        ],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 256
    },
    "prerequisites": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "source": {
            "enum": [
              "vulnerabilities",
              "attackerInitialPrivileges",
              "requiredUserActions",
              "loggingConfiguration",
              "authenticationConditions",
              "otherConditions"
            ]
          },
          "predicate": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "args": {
            "type": "array",
            "items": {
              "type": "string",
              "pattern": "^\\$[a-z][a-z0-9_-]*$",
              "maxLength": 81
            },
            "minItems": 1,
            "maxItems": 8
          },
          "value": {
            "type": "boolean"
          },
          "description": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          }
        },
        "required": [
          "source",
          "predicate",
          "args",
          "value",
          "description"
        ],
        "additionalProperties": false
      },
      "minItems": 1,
      "maxItems": 64
    },
    "requiredPrivileges": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "source": {
            "enum": [
              "vulnerabilities",
              "attackerInitialPrivileges",
              "requiredUserActions",
              "loggingConfiguration",
              "authenticationConditions",
              "otherConditions"
            ]
          },
          "predicate": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "args": {
            "type": "array",
            "items": {
              "type": "string",
              "pattern": "^\\$[a-z][a-z0-9_-]*$",
              "maxLength": 81
            },
            "minItems": 1,
            "maxItems": 8
          },
          "value": {
            "type": "boolean"
          },
          "description": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          }
        },
        "required": [
          "source",
          "predicate",
          "args",
          "value",
          "description"
        ],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 64
    },
    "requiredReachability": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "from": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "toService": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "description": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          }
        },
        "required": [
          "from",
          "toService",
          "description"
        ],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 64
    },
    "effects": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "source": {
            "enum": [
              "attackerInitialPrivileges",
              "authenticationConditions",
              "otherConditions"
            ]
          },
          "predicate": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "args": {
            "type": "array",
            "items": {
              "type": "string",
              "pattern": "^\\$[a-z][a-z0-9_-]*$",
              "maxLength": 81
            },
            "minItems": 1,
            "maxItems": 8
          },
          "value": {
            "type": "boolean"
          },
          "description": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          }
        },
        "required": [
          "source",
          "predicate",
          "args",
          "value",
          "description"
        ],
        "additionalProperties": false
      },
      "minItems": 1,
      "maxItems": 64
    },
    "observableArtifacts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "description": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          },
          "conditions": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "source": {
                  "enum": [
                    "vulnerabilities",
                    "attackerInitialPrivileges",
                    "requiredUserActions",
                    "loggingConfiguration",
                    "authenticationConditions",
                    "otherConditions"
                  ]
                },
                "predicate": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "args": {
                  "type": "array",
                  "items": {
                    "type": "string",
                    "pattern": "^\\$[a-z][a-z0-9_-]*$",
                    "maxLength": 81
                  },
                  "minItems": 1,
                  "maxItems": 8
                },
                "value": {
                  "type": "boolean"
                },
                "description": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 2000
                }
              },
              "required": [
                "source",
                "predicate",
                "args",
                "value",
                "description"
              ],
              "additionalProperties": false
            },
            "minItems": 1,
            "maxItems": 32
          }
        },
        "required": [
          "id",
          "description",
          "conditions"
        ],
        "additionalProperties": false
      },
      "minItems": 0,
      "maxItems": 64
    },
    "relatedAttackPatterns": {
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 2000
      },
      "minItems": 0,
      "maxItems": 64
    },
    "references": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80,
            "pattern": "^[a-z][a-z0-9_-]*$"
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          },
          "url": {
            "type": "string",
            "pattern": "^https://",
            "maxLength": 2048
          },
          "supports": {
            "type": "string",
            "minLength": 1,
            "maxLength": 2000
          }
        },
        "required": [
          "id",
          "title",
          "url",
          "supports"
        ],
        "additionalProperties": false
      },
      "minItems": 1,
      "maxItems": 32
    }
  },
  "required": [
    "schemaVersion",
    "id",
    "label",
    "description",
    "category",
    "bindings",
    "targetTypes",
    "platforms",
    "requiredServices",
    "prerequisites",
    "requiredPrivileges",
    "requiredReachability",
    "effects",
    "observableArtifacts",
    "relatedAttackPatterns",
    "references"
  ],
  "additionalProperties": false
}

-->

<!-- 2026-09-20 修正前: data/attacks/phishing.json（攻撃選択の拡張。JSONはコメント不可のためここに保存）
{
  "schemaVersion": "1.0",
  "id": "phishing",
  "label": "フィッシング（メール内リンク誘導）",
  "category": "social_engineering",
  "description": "初期対応範囲は、欺瞞的なメール内リンクを利用者が開き、対象Webリクエストをブラウザから送るまで。認証情報窃取、マルウェア実行、端末侵害を効果に含めない。メール閲覧経路とリンク先への到達性は別々に確認する。",
  "supportedInvestigationTypes": ["EMAIL", "AUTH_LOG", "BROWSER_HISTORY", "WEB_LOG"],
  "authoring": {
    "preferredInvestigationType": "EMAIL",
    "evidenceAnswer": "メールのヘッダーと本文から送信経路と誘導先を確認し、同時刻のWebアクセス記録と対応付ける。",
    "sourceNodeBinding": "sender",
    "targetServiceBinding": "web",
    "investigationServiceBinding": "mail"
  },
  "bindings": [
    {
      "id": "attacker",
      "kind": "entity"
    },
    {
      "id": "victim",
      "kind": "entity"
    },
    {
      "id": "sender",
      "kind": "node"
    },
    {
      "id": "client",
      "kind": "node"
    },
    {
      "id": "browser",
      "kind": "service"
    },
    {
      "id": "mail_host",
      "kind": "node"
    },
    {
      "id": "mail",
      "kind": "service"
    },
    {
      "id": "web_host",
      "kind": "node"
    },
    {
      "id": "web",
      "kind": "service"
    },
    {
      "id": "request",
      "kind": "entity"
    }
  ],
  "targetTypes": [
    {
      "binding": "attacker",
      "values": [
        "actor"
      ]
    },
    {
      "binding": "victim",
      "values": [
        "user"
      ]
    },
    {
      "binding": "request",
      "values": [
        "web_request"
      ]
    }
  ],
  "requiredRoles": [
    {
      "binding": "sender",
      "values": [
        "sender"
      ]
    },
    {
      "binding": "client",
      "values": [
        "workstation"
      ]
    },
    {
      "binding": "mail_host",
      "values": [
        "mail_server"
      ]
    },
    {
      "binding": "web_host",
      "values": [
        "web_server"
      ]
    }
  ],
  "platforms": [
    {
      "binding": "browser",
      "values": [
        "browser"
      ]
    },
    {
      "binding": "web",
      "values": [
        "web"
      ]
    }
  ],
  "requiredServices": [
    {
      "binding": "browser",
      "node": "client",
      "values": [
        "web_browser"
      ]
    },
    {
      "binding": "mail",
      "node": "mail_host",
      "values": [
        "email"
      ]
    },
    {
      "binding": "web",
      "node": "web_host",
      "values": [
        "web_application"
      ]
    }
  ],
  "prerequisites": [
    {
      "source": "otherConditions",
      "predicate": "request_targets_service",
      "args": [
        "$request",
        "$web"
      ],
      "value": true,
      "description": "このリクエストのURL・経路は、割り当てたWebサービスを対象とする。"
    },
    {
      "source": "otherConditions",
      "predicate": "user_uses_browser",
      "args": [
        "$victim",
        "$browser"
      ],
      "value": true,
      "description": "この利用者が、割り当てたブラウザを使用するというシナリオ条件。利用記録だけから人物を断定したものではない。"
    },
    {
      "source": "otherConditions",
      "predicate": "deceptive_email_deliverable",
      "args": [
        "$attacker",
        "$sender",
        "$mail",
        "$victim",
        "$request"
      ],
      "value": true,
      "description": "この送信元からこの利用者へ、対象リクエストへの誘導リンクを含む欺瞞的メールを配送でき、配送・受信フィルターに遮断されない。"
    },
    {
      "source": "requiredUserActions",
      "predicate": "follows_email_link",
      "args": [
        "$victim",
        "$mail",
        "$browser",
        "$request"
      ],
      "value": true,
      "description": "利用者が当該メールのリンクを当該ブラウザで開くという明示条件。配信成功からクリックを推測しない。"
    },
    {
      "source": "authenticationConditions",
      "predicate": "mail_access_permitted",
      "args": [
        "$victim",
        "$mail"
      ],
      "value": true,
      "description": "利用者がメールを閲覧できるための認証・認可条件を満たす。"
    },
    {
      "source": "authenticationConditions",
      "predicate": "request_access_permitted",
      "args": [
        "$victim",
        "$web",
        "$request"
      ],
      "value": true,
      "description": "この利用者による対象リクエストが必要な認証・認可条件を満たす。認証不要の場合も確認済みとして明示する。"
    }
  ],
  "requiredPrivileges": [
    {
      "source": "attackerInitialPrivileges",
      "predicate": "controls_node",
      "args": [
        "$attacker",
        "$sender"
      ],
      "value": true,
      "description": "攻撃者が送信に使用するノードを操作できる。受信者のアカウント権限は不要。"
    }
  ],
  "requiredReachability": [
    {
      "from": "sender",
      "toService": "mail",
      "description": "送信元から配送先メールサービスへの到達性。中継を含む場合は構成上の経路と実効到達性を明示する。"
    },
    {
      "from": "client",
      "toService": "mail",
      "description": "利用者端末からメールを閲覧するサービスへの到達性。"
    },
    {
      "from": "client",
      "toService": "web",
      "description": "利用者端末からリンク先Webサービスへの到達性。"
    }
  ],
  "effects": [
    {
      "source": "otherConditions",
      "predicate": "browser_request_issued",
      "args": [
        "$victim",
        "$browser",
        "$web",
        "$request"
      ],
      "value": true,
      "description": "この利用者・ブラウザ・Webサービス・リクエストに限定したアクセス。認証情報取得やコード実行を意味しない。"
    }
  ],
  "observableArtifacts": [
    {
      "id": "email_record",
      "description": "誘導リンクを含むメール。保存・取得可能性が確認された場合のみ証拠候補にする。差出人表示だけで送信した人物を断定できない。",
      "conditions": [
        {
          "source": "loggingConfiguration",
          "predicate": "email_record_available",
          "args": [
            "$mail",
            "$victim",
            "$request"
          ],
          "value": true,
          "description": "対象利用者宛ての誘導メールが本文・ヘッダーを含め保持され、調査で取得可能である。"
        }
      ]
    },
    {
      "id": "web_access_record",
      "description": "対象リクエストのアクセス記録。取得設定と保持が確認された場合のみ候補にする。これだけではスクリプト実行や実際の操作者を断定できない。",
      "conditions": [
        {
          "source": "loggingConfiguration",
          "predicate": "access_record_available",
          "args": [
            "$web",
            "$request"
          ],
          "value": true,
          "description": "対象リクエストが記録対象で、必要な時刻・対象情報を含むアクセス記録が取得・保持されている。"
        }
      ]
    }
  ],
  "relatedAttackPatterns": [
    "MITRE ATT&CK T1566.002"
  ],
  "references": [
    {
      "id": "mitre_phishing_link",
      "title": "MITRE ATT&CK: Spearphishing Link",
      "url": "https://attack.mitre.org/techniques/T1566/002/",
      "supports": "prerequisites/effects: 電子的な誘導と利用者によるリンク操作。初期モデルではサイト訪問後の追加侵害を効果にしない。"
    },
    {
      "id": "owasp_logging",
      "title": "OWASP Logging Cheat Sheet",
      "url": "https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html",
      "supports": "observableArtifacts: ログの取得内容・取得設定・保持を個別に確認する原則。製品固有のイベントIDや既定記録は保証しない。"
    }
  ]
}

-->

<!-- 2026-09-20 修正前: data/attacks/reflected_xss.json（攻撃選択の拡張。JSONはコメント不可のためここに保存）
{
  "schemaVersion": "1.0",
  "id": "reflected_xss",
  "label": "反射型クロスサイトスクリプティング",
  "category": "web_injection",
  "description": "攻撃者の入力がWeb応答に反射され、利用者のブラウザで対象オリジンのスクリプトとして実行される範囲。Cookie窃取、認証回避、OSコマンド実行、SQL injectionを自動的な効果にしない。",
  "supportedInvestigationTypes": ["WEB_LOG", "PROXY_LOG", "BROWSER_HISTORY", "APPLICATION_LOG"],
  "authoring": {
    "preferredInvestigationType": "WEB_LOG",
    "evidenceAnswer": "Webアクセス記録から反射された入力を含む対象リクエストを確認し、端末の実行計測記録と対応付ける。",
    "sourceNodeBinding": "client",
    "targetServiceBinding": "web",
    "investigationServiceBinding": "web"
  },
  "bindings": [
    {
      "id": "attacker",
      "kind": "entity"
    },
    {
      "id": "victim",
      "kind": "entity"
    },
    {
      "id": "client",
      "kind": "node"
    },
    {
      "id": "browser",
      "kind": "service"
    },
    {
      "id": "web_host",
      "kind": "node"
    },
    {
      "id": "web",
      "kind": "service"
    },
    {
      "id": "request",
      "kind": "entity"
    }
  ],
  "targetTypes": [
    {
      "binding": "attacker",
      "values": [
        "actor"
      ]
    },
    {
      "binding": "victim",
      "values": [
        "user"
      ]
    },
    {
      "binding": "request",
      "values": [
        "web_request"
      ]
    }
  ],
  "requiredRoles": [
    {
      "binding": "client",
      "values": [
        "workstation"
      ]
    },
    {
      "binding": "web_host",
      "values": [
        "web_server"
      ]
    }
  ],
  "platforms": [
    {
      "binding": "browser",
      "values": [
        "browser"
      ]
    },
    {
      "binding": "web",
      "values": [
        "web"
      ]
    }
  ],
  "requiredServices": [
    {
      "binding": "browser",
      "node": "client",
      "values": [
        "web_browser"
      ]
    },
    {
      "binding": "web",
      "node": "web_host",
      "values": [
        "web_application"
      ]
    }
  ],
  "prerequisites": [
    {
      "source": "otherConditions",
      "predicate": "request_targets_service",
      "args": [
        "$request",
        "$web"
      ],
      "value": true,
      "description": "このリクエストのURL・経路は、割り当てたWebサービスを対象とする。"
    },
    {
      "source": "otherConditions",
      "predicate": "user_uses_browser",
      "args": [
        "$victim",
        "$browser"
      ],
      "value": true,
      "description": "この利用者が、割り当てたブラウザを使用するというシナリオ条件。利用記録だけから人物を断定したものではない。"
    },
    {
      "source": "vulnerabilities",
      "predicate": "input_reflected_as_executable_script",
      "args": [
        "$web",
        "$request"
      ],
      "value": true,
      "description": "当該リクエストの入力が応答へ反射され、出力先文脈のエンコード等の防御が不足して実行可能なスクリプトとして解釈される。単に文字列が反射されるだけでは成立しない。"
    },
    {
      "source": "otherConditions",
      "predicate": "browser_request_issued",
      "args": [
        "$victim",
        "$browser",
        "$web",
        "$request"
      ],
      "value": true,
      "description": "対象利用者・ブラウザから当該リクエストが送られる。前段のリンク誘導効果または明示入力が必要。"
    },
    {
      "source": "otherConditions",
      "predicate": "script_execution_permitted",
      "args": [
        "$browser",
        "$web",
        "$request"
      ],
      "value": true,
      "description": "当該応答についてJavaScript設定・CSP等の実効制御がスクリプト実行を阻止しない。"
    },
    {
      "source": "authenticationConditions",
      "predicate": "request_access_permitted",
      "args": [
        "$victim",
        "$web",
        "$request"
      ],
      "value": true,
      "description": "この利用者による対象リクエストが必要な認証・認可条件を満たす。認証不要の場合も確認済みとして明示する。"
    }
  ],
  "requiredPrivileges": [
    {
      "source": "attackerInitialPrivileges",
      "predicate": "controls_request_input",
      "args": [
        "$attacker",
        "$request"
      ],
      "value": true,
      "description": "攻撃者がこのリクエストの反射される入力を構成できる。利用者やサーバーの管理者権限を仮定しない。"
    }
  ],
  "requiredReachability": [
    {
      "from": "client",
      "toService": "web",
      "description": "利用者端末から反射するWebサービスへの到達性。"
    }
  ],
  "effects": [
    {
      "source": "otherConditions",
      "predicate": "script_executed_in_origin",
      "args": [
        "$attacker",
        "$victim",
        "$browser",
        "$web",
        "$request"
      ],
      "value": true,
      "description": "このブラウザの対象Webオリジンでスクリプトが実行される。Webオリジンを越えた権限やDB権限を付与しない。"
    }
  ],
  "observableArtifacts": [
    {
      "id": "web_access_record",
      "description": "対象リクエストのアクセス記録。取得設定と保持が確認された場合のみ候補にする。これだけではスクリプト実行や実際の操作者を断定できない。",
      "conditions": [
        {
          "source": "loggingConfiguration",
          "predicate": "access_record_available",
          "args": [
            "$web",
            "$request"
          ],
          "value": true,
          "description": "対象リクエストが記録対象で、必要な時刻・対象情報を含むアクセス記録が取得・保持されている。"
        }
      ]
    },
    {
      "id": "browser_execution_record",
      "description": "当該スクリプトの実行を示すブラウザ計測記録。標準のアクセスログやCSP違反ログを実行成功の証明に置き換えない。",
      "conditions": [
        {
          "source": "loggingConfiguration",
          "predicate": "script_execution_record_available",
          "args": [
            "$browser",
            "$web",
            "$request"
          ],
          "value": true,
          "description": "当該実行を識別できるブラウザ計測が有効で、実行成功の記録が取得・保持されている。"
        }
      ]
    }
  ],
  "relatedAttackPatterns": [
    "OWASP Reflected XSS"
  ],
  "references": [
    {
      "id": "owasp_reflected_xss",
      "title": "OWASP: Cross Site Scripting (XSS)",
      "url": "https://community.owasp.org/attacks/xss/",
      "supports": "prerequisites/effects: リクエスト入力の反射、別経路での配送、ブラウザによる対象サイトのスクリプト実行。単なる反射から実行を推定しない。"
    },
    {
      "id": "owasp_logging",
      "title": "OWASP Logging Cheat Sheet",
      "url": "https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html",
      "supports": "observableArtifacts: ログの取得内容・取得設定・保持を個別に確認する原則。製品固有のイベントIDや既定記録は保証しない。"
    }
  ]
}

-->

<!-- 2026-09-20 修正前: data/attacks/sql_injection.json（攻撃選択の拡張。JSONはコメント不可のためここに保存）
{
  "schemaVersion": "1.0",
  "id": "sql_injection",
  "label": "SQLインジェクション（Webアプリ経由）",
  "category": "web_injection",
  "description": "Webアプリに送られた入力がSQLの構文・意図を変え、アプリのDB接続権限内で実行される範囲。認証回避、データ窃取・改変、DB管理者権限、OS実行は自動的な効果にしない。",
  "supportedInvestigationTypes": ["WEB_LOG", "APPLICATION_LOG", "NETWORK_LOG", "CONFIGURATION"],
  "authoring": {
    "preferredInvestigationType": "WEB_LOG",
    "evidenceAnswer": "Webアクセス記録とDB監査記録から、入力に対応してSQL構造が変化した対象リクエストを確認する。",
    "sourceNodeBinding": "source",
    "targetServiceBinding": "web",
    "investigationServiceBinding": "web"
  },
  "bindings": [
    {
      "id": "attacker",
      "kind": "entity"
    },
    {
      "id": "source",
      "kind": "node"
    },
    {
      "id": "web_host",
      "kind": "node"
    },
    {
      "id": "web",
      "kind": "service"
    },
    {
      "id": "db_host",
      "kind": "node"
    },
    {
      "id": "database",
      "kind": "service"
    },
    {
      "id": "db_principal",
      "kind": "entity"
    },
    {
      "id": "request",
      "kind": "entity"
    }
  ],
  "targetTypes": [
    {
      "binding": "attacker",
      "values": [
        "actor"
      ]
    },
    {
      "binding": "db_principal",
      "values": [
        "database_principal"
      ]
    },
    {
      "binding": "request",
      "values": [
        "web_request"
      ]
    }
  ],
  "requiredRoles": [
    {
      "binding": "web_host",
      "values": [
        "web_server"
      ]
    },
    {
      "binding": "db_host",
      "values": [
        "database_server"
      ]
    }
  ],
  "platforms": [
    {
      "binding": "web",
      "values": [
        "web"
      ]
    },
    {
      "binding": "database",
      "values": [
        "sql"
      ]
    }
  ],
  "requiredServices": [
    {
      "binding": "web",
      "node": "web_host",
      "values": [
        "web_application"
      ]
    },
    {
      "binding": "database",
      "node": "db_host",
      "values": [
        "sql_database"
      ]
    }
  ],
  "prerequisites": [
    {
      "source": "otherConditions",
      "predicate": "request_targets_service",
      "args": [
        "$request",
        "$web"
      ],
      "value": true,
      "description": "このリクエストのURL・経路は、割り当てたWebサービスを対象とする。"
    },
    {
      "source": "vulnerabilities",
      "predicate": "input_controls_sql_structure",
      "args": [
        "$web",
        "$database",
        "$request"
      ],
      "value": true,
      "description": "当該入力がSQLに組み込まれ、値として安全に束縛されずSQLの構文・意図を変えられる。単なるDB利用や任意の入力欄だけでは成立しない。"
    },
    {
      "source": "otherConditions",
      "predicate": "attacker_request_submitted",
      "args": [
        "$attacker",
        "$source",
        "$web",
        "$request"
      ],
      "value": true,
      "description": "攻撃者が当該送信元から対象リクエストを送るという明示条件。XSS実行だけからこの操作を補完しない。"
    },
    {
      "source": "authenticationConditions",
      "predicate": "request_access_permitted",
      "args": [
        "$attacker",
        "$web",
        "$request"
      ],
      "value": true,
      "description": "当該入力処理に到達するための認証・認可条件を満たす。認証不要の場合も確認済みとして明示する。"
    },
    {
      "source": "authenticationConditions",
      "predicate": "database_session_authorized",
      "args": [
        "$web",
        "$database",
        "$db_principal"
      ],
      "value": true,
      "description": "対象WebアプリがこのDB主体で対象DBへの接続認証・利用条件を満たす。"
    },
    {
      "source": "authenticationConditions",
      "predicate": "query_execution_permitted",
      "args": [
        "$db_principal",
        "$database",
        "$request"
      ],
      "value": true,
      "description": "当該改変クエリをDB主体の権限で実行できる。DBへの接続成功から管理者権限や任意操作権限を推測しない。"
    },
    {
      "source": "otherConditions",
      "predicate": "request_reaches_sql_execution",
      "args": [
        "$web",
        "$database",
        "$request"
      ],
      "value": true,
      "description": "当該リクエストがアプリ・WAF等で阻止されず、対象DBのSQL処理まで到達する。"
    }
  ],
  "requiredPrivileges": [
    {
      "source": "attackerInitialPrivileges",
      "predicate": "controls_node",
      "args": [
        "$attacker",
        "$source"
      ],
      "value": true,
      "description": "攻撃者がリクエストの送信元ノードを操作できる。"
    },
    {
      "source": "attackerInitialPrivileges",
      "predicate": "controls_request_input",
      "args": [
        "$attacker",
        "$request"
      ],
      "value": true,
      "description": "攻撃者がSQL処理へ渡る当該リクエスト入力を構成できる。"
    }
  ],
  "requiredReachability": [
    {
      "from": "source",
      "toService": "web",
      "description": "攻撃者の送信元からWebサービスへの到達性。"
    },
    {
      "from": "web_host",
      "toService": "database",
      "description": "WebアプリのノードからDBサービスへの到達性。攻撃者からDBへの直接接続は必須としない。"
    }
  ],
  "effects": [
    {
      "source": "otherConditions",
      "predicate": "sql_query_structure_modified",
      "args": [
        "$attacker",
        "$web",
        "$database",
        "$db_principal",
        "$request"
      ],
      "value": true,
      "description": "当該リクエストによりSQLが改変され、指定されたDB主体の権限範囲内で実行される。具体的な漏えい・改変被害は別途条件が必要。"
    }
  ],
  "observableArtifacts": [
    {
      "id": "web_access_record",
      "description": "対象リクエストのアクセス記録。取得設定と保持が確認された場合のみ候補にする。これだけではスクリプト実行や実際の操作者を断定できない。",
      "conditions": [
        {
          "source": "loggingConfiguration",
          "predicate": "access_record_available",
          "args": [
            "$web",
            "$request"
          ],
          "value": true,
          "description": "対象リクエストが記録対象で、必要な時刻・対象情報を含むアクセス記録が取得・保持されている。"
        }
      ]
    },
    {
      "id": "database_statement_record",
      "description": "実行されたSQLに対応するDB監査記録。対象クエリを識別できる記録内容と保持条件が必要であり、記録だけで実際の操作者は断定できない。",
      "conditions": [
        {
          "source": "loggingConfiguration",
          "predicate": "statement_record_available",
          "args": [
            "$database",
            "$db_principal",
            "$request"
          ],
          "value": true,
          "description": "当該主体のクエリを対象とする監査が有効で、当該SQLを識別できる記録が取得・保持されている。"
        }
      ]
    }
  ],
  "relatedAttackPatterns": [
    "OWASP SQL Injection"
  ],
  "references": [
    {
      "id": "owasp_sql_injection",
      "title": "OWASP: SQL Injection",
      "url": "https://community.owasp.org/attacks/SQL_Injection",
      "supports": "prerequisites/effects: Webアプリ入力によるSQL処理の改変と、DB側権限に依存する影響。個別被害やOS実行を一律に付与しない。"
    },
    {
      "id": "owasp_sql_prevention",
      "title": "OWASP: SQL Injection Prevention Cheat Sheet",
      "url": "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html",
      "supports": "input_controls_sql_structure: 値とSQL構造を分離するパラメータ化、およびDB権限の最小化。"
    },
    {
      "id": "owasp_logging",
      "title": "OWASP Logging Cheat Sheet",
      "url": "https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html",
      "supports": "observableArtifacts: ログの取得内容・取得設定・保持を個別に確認する原則。製品固有のイベントIDや既定記録は保証しない。"
    }
  ]
}

-->

<!-- 2026-09-20 修正前: schemas/network-preset.schema.json（攻撃選択の拡張。JSONはコメント不可のためここに保存）
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Network Preset v1",
  "type": "object",
  "properties": {
    "schemaVersion": {
      "const": "1.0"
    },
    "id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 80,
      "pattern": "^[a-z][a-z0-9_-]*$"
    },
    "label": {
      "type": "string",
      "minLength": 1,
      "maxLength": 120
    },
    "description": {
      "type": "string",
      "minLength": 1,
      "maxLength": 500
    },
    "network": {
      "type": "object",
      "properties": {
        "subnets": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "subnetId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80,
                "pattern": "^[a-z][a-z0-9_-]*$"
              },
              "label": {
                "type": "string",
                "minLength": 1,
                "maxLength": 120
              },
              "cidr": {
                "type": "string",
                "minLength": 3,
                "maxLength": 80
              },
              "trustBoundaryId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80,
                "pattern": "^[a-z][a-z0-9_-]*$"
              }
            },
            "required": [
              "subnetId",
              "label",
              "cidr",
              "trustBoundaryId"
            ],
            "additionalProperties": false
          },
          "minItems": 1,
          "maxItems": 32
        },
        "nodes": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "nodeId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80,
                "pattern": "^[a-z][a-z0-9_-]*$"
              },
              "label": {
                "type": "string",
                "minLength": 1,
                "maxLength": 120
              },
              "nodeType": {
                "enum": [
                  "CLIENT",
                  "SERVER",
                  "PROXY",
                  "WEB_SERVER",
                  "DATABASE",
                  "AD",
                  "FILE_SERVER",
                  "LOG_SERVER",
                  "MAIL_SERVER",
                  "EXTERNAL"
                ]
              },
              "os": {
                "enum": [
                  "windows",
                  "linux",
                  "macos",
                  "network",
                  "other"
                ]
              },
              "ip": {
                "type": "string",
                "minLength": 3,
                "maxLength": 80
              },
              "subnetId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80,
                "pattern": "^[a-z][a-z0-9_-]*$"
              },
              "trustBoundaryId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80,
                "pattern": "^[a-z][a-z0-9_-]*$"
              },
              "roles": {
                "type": "array",
                "items": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80,
                  "pattern": "^[a-z][a-z0-9_-]*$"
                },
                "minItems": 1,
                "maxItems": 16
              },
              "logSources": {
                "type": "array",
                "items": {
                  "enum": [
                    "WEB_LOG",
                    "PROXY_LOG",
                    "AUTH_LOG",
                    "APPLICATION_LOG",
                    "NETWORK_LOG",
                    "EMAIL",
                    "BROWSER_HISTORY",
                    "DEVICE",
                    "FILE",
                    "CONFIGURATION"
                  ]
                },
                "minItems": 0,
                "maxItems": 10
              }
            },
            "required": [
              "nodeId",
              "label",
              "nodeType",
              "os",
              "ip",
              "subnetId",
              "trustBoundaryId",
              "roles",
              "logSources"
            ],
            "additionalProperties": false
          },
          "minItems": 1,
          "maxItems": 128
        },
        "services": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "serviceId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80,
                "pattern": "^[a-z][a-z0-9_-]*$"
              },
              "nodeId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80,
                "pattern": "^[a-z][a-z0-9_-]*$"
              },
              "label": {
                "type": "string",
                "minLength": 1,
                "maxLength": 120
              },
              "serviceType": {
                "enum": [
                  "web_browser",
                  "email",
                  "web_application",
                  "sql_database",
                  "proxy",
                  "authentication",
                  "file",
                  "logging"
                ]
              },
              "platform": {
                "enum": [
                  "browser",
                  "email",
                  "web",
                  "sql",
                  "proxy",
                  "auth",
                  "file",
                  "logging"
                ]
              }
            },
            "required": [
              "serviceId",
              "nodeId",
              "label",
              "serviceType",
              "platform"
            ],
            "additionalProperties": false
          },
          "minItems": 1,
          "maxItems": 256
        },
        "connections": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "fromNodeId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80,
                "pattern": "^[a-z][a-z0-9_-]*$"
              },
              "toNodeId": {
                "type": "string",
                "minLength": 1,
                "maxLength": 80,
                "pattern": "^[a-z][a-z0-9_-]*$"
              }
            },
            "required": [
              "fromNodeId",
              "toNodeId"
            ],
            "additionalProperties": false
          },
          "minItems": 0,
          "maxItems": 1024
        }
      },
      "required": [
        "subnets",
        "nodes",
        "services",
        "connections"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "schemaVersion",
    "id",
    "label",
    "description",
    "network"
  ],
  "additionalProperties": false
}

-->
