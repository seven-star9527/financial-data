import base64
import requests
import time
import os
from dotenv import load_dotenv

load_dotenv()

class YesCaptchaSolver:
    def __init__(self, client_key=None):
        self.client_key = client_key or os.getenv("YESCAPTCHA_CLIENT_KEY")
        self.base_url = "https://api.yescaptcha.com"

    def solve_image_to_text(self, image_base64, task_type="ImageToTextTaskOcrBase"):
        """
        使用 ImageToTextTaskOcrBase (同步) 或 ImageToTextTask (异步) 识别验证码
        """
        # 确保没有换行符
        image_base64 = image_base64.replace("\n", "").replace("\r", "")
        
        payload = {
            "clientKey": self.client_key,
            "task": {
                "type": task_type,
                "body": image_base64
            }
        }
        
        try:
            response = requests.post(f"{self.base_url}/createTask", json=payload, timeout=10)
            res_data = response.json()
            
            if res_data.get("errorId") == 0:
                # 同步任务直接返回结果
                if res_data.get("status") == "ready":
                    return res_data.get("solution", {}).get("text")
                
                # 异步任务需要轮询
                task_id = res_data.get("taskId")
                if task_id:
                    return self._get_task_result(task_id)
            else:
                print(f"创建任务失败: {res_data}")
                return None
        except Exception as e:
            print(f"YesCaptcha API 错误: {e}")
            return None

    def _get_task_result(self, task_id):
        """
        获取任务结果（轮询）
        """
        max_retries = 10
        for _ in range(max_retries):
            try:
                payload = {
                    "clientKey": self.client_key,
                    "taskId": task_id
                }
                response = requests.post(f"{self.base_url}/getTaskResult", json=payload, timeout=10)
                res_data = response.json()
                
                if res_data.get("status") == "ready":
                    return res_data.get("solution", {}).get("text")
                
                time.sleep(1)
            except Exception as e:
                print(f"查询结果错误: {e}")
                break
        return None

if __name__ == "__main__":
    solver = YesCaptchaSolver()
    print(f"API Key: {solver.client_key[:10]}...")
