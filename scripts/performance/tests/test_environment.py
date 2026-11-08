import base64
import json
import subprocess
import unittest
from unittest.mock import patch

from collect_environment import registry_manifest
from common import sha256_bytes


class RegistryManifestTest(unittest.TestCase):
    def test_verbose_manifest_is_primary_and_reports_compressed_size(self):
        raw = json.dumps({
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "config": {"size": 7},
            "layers": [{"size": 11}, {"size": 13}],
        }).encode()
        verbose = json.dumps([{
            "Descriptor": {
                "digest": "sha256:" + sha256_bytes(raw),
                "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "platform": {"os": "linux", "architecture": "amd64"},
            },
            "Raw": base64.b64encode(raw).decode(),
        }]).encode()
        completed = subprocess.CompletedProcess([], 0, stdout=verbose, stderr=b"")
        with patch("collect_environment.command", return_value=completed) as command:
            result = registry_manifest("example.invalid/image:tag")
        self.assertEqual(result["inspection_method"], "docker manifest inspect --verbose")
        self.assertEqual(result["manifest_sha256"], "sha256:" + sha256_bytes(raw))
        self.assertEqual(result["compressed_config_and_layers_bytes"], 31)
        self.assertEqual(result["platform"]["architecture"], "amd64")
        self.assertEqual(command.call_count, 1)
        self.assertEqual(command.call_args.args[0][:3], ["docker", "manifest", "inspect"])

    def test_buildx_remains_fallback(self):
        raw = b'{"mediaType":"application/vnd.oci.image.manifest.v1+json","config":{"size":2},"layers":[{"size":3}]}'

        def command(args, **kwargs):
            if args[1] == "manifest":
                return subprocess.CompletedProcess(args, 125, stdout=b"", stderr=b"unsupported")
            return subprocess.CompletedProcess(args, 0, stdout=raw, stderr=b"")

        with patch("collect_environment.command", side_effect=command) as mocked:
            result = registry_manifest("example.invalid/image:tag")
        self.assertEqual(result["inspection_method"], "docker buildx imagetools inspect --raw")
        self.assertEqual(result["compressed_config_and_layers_bytes"], 5)
        self.assertEqual(mocked.call_count, 2)


if __name__ == "__main__":
    unittest.main()
